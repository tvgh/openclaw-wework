import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";
import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";

import { workWeixinPlugin } from "./src/channel.js";
import { setWorkWeixinRuntime, getWorkWeixinRuntime } from "./src/runtime.js";

// Signature verification for WeChat Work callback
function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  echostr: string,
  signature: string
): boolean {
  const sorted = [token, timestamp, nonce, echostr].sort();
  const signatureStr = crypto
    .createHash("sha1")
    .update(sorted.join(""))
    .digest("hex");
  return signature === signatureStr;
}

// Decrypt message using AES-256-CBC
function decryptMessage(encodingAESKey: string, encrypted: string): string {
  const key = Buffer.from(encodingAESKey + "=", "base64");
  const iv = key.slice(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);

  let decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]);

  // Remove PKCS7 padding
  const pad = decrypted[decrypted.length - 1];
  decrypted = decrypted.slice(0, -pad);

  // Format: [16 bytes random][4 bytes length][content][corpId]
  const contentLen = decrypted.readUInt32BE(16);
  const content = decrypted.slice(20, 20 + contentLen);

  return content.toString("utf8");
}

// Read request body
async function readRequestBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// Parse WeChat Work message XML
interface WxMessage {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: string;
  Content?: string;
  MsgId?: string;
  AgentID?: string;
  PicUrl?: string;
  MediaId?: string;
}

function parseWxMessage(xml: string): WxMessage | null {
  try {
    const parser = new XMLParser();
    const result = parser.parse(xml);
    return result.xml || null;
  } catch {
    return null;
  }
}

const plugin = {
  id: "workweixin",
  name: "WorkWeixin",
  description: "Enterprise WeChat channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    setWorkWeixinRuntime(api.runtime);
    api.registerChannel({ plugin: workWeixinPlugin });


    // Register webhook HTTP route for WeChat Work callback verification and messages
    api.registerHttpRoute({
      path: "/webhooks/workweixin",
      handler: async (req: any, res: any) => {
        try {
          const core = getWorkWeixinRuntime();
          const cfg = core.config.loadConfig() as any;
          const wxConfig = cfg?.channels?.workweixin || {};
          const { token, encodingAESKey } = wxConfig;

          const url = new URL(req.url || "/", "http://localhost");
          const msg_signature = url.searchParams.get("msg_signature") || "";
          const timestamp = url.searchParams.get("timestamp") || "";
          const nonce = url.searchParams.get("nonce") || "";

          // GET request - URL verification
          if (req.method === "GET") {
            const echostr = url.searchParams.get("echostr") || "";

            if (!token || !encodingAESKey) {
              res.statusCode = 500;
              res.end("WorkWeixin not configured");
              return;
            }

            if (!verifySignature(token, timestamp, nonce, echostr, msg_signature)) {
              res.statusCode = 401;
              res.end("Signature verification failed");
              return;
            }

            try {
              const decrypted = decryptMessage(encodingAESKey, echostr);
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/plain");
              res.end(decrypted);
            } catch (err) {
              api.logger.error("WorkWeixin echostr decryption failed: " + String(err));
              res.statusCode = 500;
              res.end("Decryption failed");
            }
            return;
          }

          // POST request - Message handling
          if (req.method === "POST") {
            if (!token || !encodingAESKey) {
              api.logger.error("WorkWeixin not configured for message handling");
              res.statusCode = 200;
              res.end("success");
              return;
            }

            // Read and parse the request body
            const body = await readRequestBody(req);
            api.logger.info("WorkWeixin received POST: " + body.slice(0, 200));

            // Parse outer XML to get Encrypt field
            const parser = new XMLParser();
            const outerXml = parser.parse(body);
            const encryptedMsg = outerXml?.xml?.Encrypt;

            if (!encryptedMsg) {
              api.logger.warn("WorkWeixin: no Encrypt field in message");
              res.statusCode = 200;
              res.end("success");
              return;
            }

            // Verify signature
            if (!verifySignature(token, timestamp, nonce, encryptedMsg, msg_signature)) {
              api.logger.warn("WorkWeixin: message signature verification failed");
              res.statusCode = 200;
              res.end("success");
              return;
            }

            // Decrypt the message
            let decryptedXml: string;
            try {
              decryptedXml = decryptMessage(encodingAESKey, encryptedMsg);
            } catch (err) {
              api.logger.error("WorkWeixin message decryption failed: " + String(err));
              res.statusCode = 200;
              res.end("success");
              return;
            }

            api.logger.info("WorkWeixin decrypted message: " + decryptedXml.slice(0, 300));

            // Parse the decrypted message
            const wxMsg = parseWxMessage(decryptedXml);
            if (!wxMsg) {
              api.logger.warn("WorkWeixin: failed to parse decrypted message");
              res.statusCode = 200;
              res.end("success");
              return;
            }

            api.logger.info("WorkWeixin message from: " + wxMsg.FromUserName + " type: " + wxMsg.MsgType + " content: " + (wxMsg.Content || ""));

            // Only handle text messages for now
            if (wxMsg.MsgType !== "text" || !wxMsg.Content) {
              api.logger.info("WorkWeixin: ignoring non-text message type: " + wxMsg.MsgType);
              res.statusCode = 200;
              res.end("success");
              return;
            }

            // Get access token for sending replies
            const getAccessToken = async (): Promise<string> => {
              const tokenUrl = "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=" + wxConfig.corpId + "&corpsecret=" + wxConfig.corpSecret;
              const tokenResp = await fetch(tokenUrl);
              const tokenData = await tokenResp.json() as any;
              if (tokenData.errcode !== 0) {
                throw new Error("Failed to get access token: " + tokenData.errmsg);
              }
              return tokenData.access_token;
            };

            // Build context payload
            const senderId = wxMsg.FromUserName;
            const messageId = wxMsg.MsgId || String(wxMsg.CreateTime);
            const messageText = wxMsg.Content;
            const messageTimestamp = wxMsg.CreateTime * 1000;

            const route = core.channel.routing.resolveAgentRoute({
              cfg,
              channel: "workweixin",
              accountId: "default",
              peer: {
                kind: "dm",
                id: senderId,
              },
            });

            const ctxPayload = core.channel.reply.finalizeInboundContext({
              Body: messageText,
              RawBody: messageText,
              CommandBody: messageText,
              From: "workweixin:" + senderId,
              To: "workweixin:" + senderId,
              SessionKey: route.sessionKey,
              AccountId: route.accountId,
              ChatType: "direct",
              ConversationLabel: senderId,
              SenderId: senderId,
              Provider: "workweixin",
              Surface: "workweixin",
              MessageSid: messageId,
              Timestamp: messageTimestamp,
              OriginatingChannel: "workweixin",
              OriginatingTo: "workweixin:" + senderId,
            });

            api.logger.info("WorkWeixin dispatching to agent for user: " + senderId);

            // Dispatch to agent
            try {
              await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                ctx: ctxPayload,
                cfg,
                dispatcherOptions: {
                  responsePrefix: core.channel.reply.resolveEffectiveMessagesConfig(cfg, route.agentId).responsePrefix,
                  deliver: async (payload: any) => {
                    const text = payload.text || payload.body || "";
                    if (!text) {
                      api.logger.warn("WorkWeixin: empty reply, skipping");
                      return;
                    }

                    api.logger.info("WorkWeixin sending reply to " + senderId + ": " + text.slice(0, 100));

                    try {
                      const accessToken = await getAccessToken();
                      const sendUrl = "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=" + accessToken;
                      const sendResp = await fetch(sendUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          touser: senderId,
                          msgtype: "text",
                          agentid: wxConfig.agentId,
                          text: { content: text },
                        }),
                      });
                      const sendData = await sendResp.json() as any;
                      if (sendData.errcode !== 0) {
                        api.logger.error("WorkWeixin send failed: " + sendData.errmsg);
                      } else {
                        api.logger.info("WorkWeixin reply sent successfully");
                      }
                    } catch (sendErr) {
                      api.logger.error("WorkWeixin send error: " + String(sendErr));
                    }
                  },
                },
              });
            } catch (dispatchErr) {
              api.logger.error("WorkWeixin dispatch error: " + String(dispatchErr));
            }

            res.statusCode = 200;
            res.end("success");
            return;
          }

          res.statusCode = 405;
          res.end("Method not allowed");
        } catch (err: any) {
          const errMsg = err && err.message ? err.message : String(err);
          api.logger.error("WorkWeixin webhook error: " + errMsg);
          res.statusCode = 500;
          res.end("Internal error");
        }
      },
    });
  },
};

export default plugin;
