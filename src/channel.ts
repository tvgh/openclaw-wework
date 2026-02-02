import {
  getChatChannelMeta,
  type ChannelPlugin,
} from "clawdbot/plugin-sdk";

import { getWorkWeixinRuntime } from "./runtime.js";

const meta = getChatChannelMeta("workweixin");

// WorkWeixin account config interface
interface WorkWeixinAccountConfig {
  enabled?: boolean;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  token?: string;
  encodingAESKey?: string;
  dmPolicy?: string;
  allowFrom?: string[];
}

interface ResolvedWorkWeixinAccount {
  accountId: string;
  name: string | null;
  enabled: boolean;
  config: WorkWeixinAccountConfig;
}

interface WorkWeixinConfig {
  enabled?: boolean;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  token?: string;
  encodingAESKey?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  accounts?: Record<string, WorkWeixinAccountConfig>;
}

function getWorkWeixinConfig(cfg: any): WorkWeixinConfig | undefined {
  return cfg?.channels?.workweixin;
}

function resolveWorkWeixinAccount(cfg: any, accountId: string): ResolvedWorkWeixinAccount {
  const wxConfig = getWorkWeixinConfig(cfg) || {};

  if (accountId === "default" || !accountId) {
    return {
      accountId: "default",
      name: null,
      enabled: wxConfig.enabled ?? false,
      config: {
        corpId: wxConfig.corpId,
        corpSecret: wxConfig.corpSecret,
        agentId: wxConfig.agentId,
        token: wxConfig.token,
        encodingAESKey: wxConfig.encodingAESKey,
        dmPolicy: wxConfig.dmPolicy,
        allowFrom: wxConfig.allowFrom,
      },
    };
  }

  const accountConfig = wxConfig.accounts?.[accountId] || {};
  return {
    accountId,
    name: null,
    enabled: accountConfig.enabled ?? false,
    config: accountConfig,
  };
}

function listWorkWeixinAccountIds(cfg: any): string[] {
  const wxConfig = getWorkWeixinConfig(cfg);
  if (!wxConfig) return [];

  const ids: string[] = [];
  if (wxConfig.corpId || wxConfig.enabled) {
    ids.push("default");
  }
  if (wxConfig.accounts) {
    ids.push(...Object.keys(wxConfig.accounts));
  }
  return ids;
}

// WeChat Work API helper
async function getAccessToken(corpId: string, corpSecret: string): Promise<string> {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`;
  const response = await fetch(url);
  const data = await response.json() as { errcode?: number; access_token?: string; errmsg?: string };

  if (data.errcode !== 0) {
    throw new Error(`Failed to get access token: ${data.errmsg}`);
  }
  return data.access_token!;
}

async function sendWorkWeixinMessage(
  toUser: string,
  content: string,
  config: WorkWeixinAccountConfig
): Promise<{ success: boolean; msgid?: string }> {
  const token = await getAccessToken(config.corpId!, config.corpSecret!);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      msgtype: "text",
      agentid: config.agentId,
      text: { content },
    }),
  });

  const data = await response.json() as { errcode?: number; msgid?: string; errmsg?: string };
  if (data.errcode !== 0) {
    throw new Error(`Failed to send message: ${data.errmsg}`);
  }

  return { success: true, msgid: data.msgid };
}

export const workWeixinPlugin: ChannelPlugin<ResolvedWorkWeixinAccount> = {
  id: "workweixin",
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  pairing: {
    idLabel: "workweixinUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(workweixin|wx|weixin):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveWorkWeixinAccount(cfg, "default");
      await sendWorkWeixinMessage(
        id,
        "配对已批准！您现在可以通过企微向Clawdbot发送消息。",
        account.config
      );
    },
  },
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.workweixin"] },
  configSchema: {
    safeParse(value: unknown) {
      return { success: true, data: value };
    },
    jsonSchema: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  },
  config: {
    listAccountIds: (cfg) => listWorkWeixinAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveWorkWeixinAccount(cfg, accountId),
    defaultAccountId: (cfg) => listWorkWeixinAccountIds(cfg)[0] || "default",
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const next = { ...cfg };
      if (!next.channels) next.channels = {};
      if (!next.channels.workweixin) next.channels.workweixin = {};
      if (accountId === "default") {
        next.channels.workweixin.enabled = enabled;
      } else {
        if (!next.channels.workweixin.accounts) next.channels.workweixin.accounts = {};
        if (!next.channels.workweixin.accounts[accountId]) next.channels.workweixin.accounts[accountId] = {};
        next.channels.workweixin.accounts[accountId].enabled = enabled;
      }
      return next;
    },
    deleteAccount: ({ cfg, accountId }) => {
      const next = { ...cfg };
      if (accountId === "default" && next.channels?.workweixin) {
        delete next.channels.workweixin.corpId;
        delete next.channels.workweixin.corpSecret;
        delete next.channels.workweixin.agentId;
      } else if (next.channels?.workweixin?.accounts?.[accountId]) {
        delete next.channels.workweixin.accounts[accountId];
      }
      return next;
    },
    isConfigured: (account) =>
      Boolean(account.config.corpId?.trim()) && Boolean(account.config.corpSecret?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.corpId?.trim()) && Boolean(account.config.corpSecret?.trim()),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveWorkWeixinAccount(cfg, accountId).config.allowFrom ?? []).map(String),
    formatAllowFrom: ({ allowFrom }) => allowFrom.map(String).filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => ({
      policy: account.config.dmPolicy ?? "pairing",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: `channels.workweixin.dmPolicy`,
      allowFromPath: `channels.workweixin.`,
      approveHint: `clawdbot channels approve workweixin <userId>`,
      normalizeEntry: (raw) => raw.replace(/^(workweixin|wx|weixin):/i, ""),
    }),
    collectWarnings: () => [],
  },
  groups: {
    resolveRequireMention: () => true,
    resolveToolPolicy: () => "allow",
  },
  threading: {
    resolveReplyToMode: () => "first",
  },
  messaging: {
    normalizeTarget: (target) => String(target ?? "").trim().replace(/^(workweixin|wx|weixin):/i, ""),
    targetResolver: {
      looksLikeId: (target) => {
        const t = String(target ?? "").trim();
        return t.length > 0 && t.length <= 64;
      },
      hint: "<userId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  actions: {
    listActions: () => [{ id: "reply", label: "Reply", icon: "reply" }],
    extractToolSend: () => null,
    handleAction: async ({ action }) => {
      if (action.id === "reply") {
        return { action: "reply" };
      }
      return { action: "unknown" };
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId ?? "default",
    applyAccountName: ({ cfg }) => cfg,
    validateInput: ({ input }) => {
      if (!input.corpId && !input.corpSecret) {
        return "WorkWeixin requires --corp-id and --corp-secret.";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const next = { ...cfg };
      if (!next.channels) next.channels = {};
      if (!next.channels.workweixin) next.channels.workweixin = {};

      if (accountId === "default") {
        next.channels.workweixin = {
          ...next.channels.workweixin,
          enabled: true,
          corpId: input.corpId,
          corpSecret: input.corpSecret,
          agentId: input.agentId,
        };
      }
      return next;
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => {
      if (!text) return [];
      const chunks = [];
      const size = limit || 2000;
      let remaining = String(text);
      while (remaining.length > size) {
        chunks.push(remaining.slice(0, size));
        remaining = remaining.slice(size);
      }
      if (remaining.length) chunks.push(remaining);
      return chunks;
    },
    chunkerMode: "text",
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const account = resolveWorkWeixinAccount(cfg, accountId ?? "default");
      const result = await sendWorkWeixinMessage(to, text, account.config);
      return { channel: "workweixin", ...result };
    },
    sendMedia: async () => {
      throw new Error("Media not yet supported");
    },
  },
  status: {
    defaultRuntime: { accountId: "default", running: false, lastStartAt: null, lastStopAt: null, lastError: null },
    collectStatusIssues: () => [],
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
    }),
    probeAccount: async ({ account }) => {
      try {
        await getAccessToken(account.config.corpId!, account.config.corpSecret!);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    auditAccount: async () => undefined,
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.corpId?.trim()) && Boolean(account.config.corpSecret?.trim()),
      running: runtime?.running ?? false,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[workweixin] Starting provider for account: ${account.accountId}`);
      // For now, just return an empty async generator
      // Real implementation would set up webhook listener
      return (async function* () {
        // Placeholder - webhook handling would go here
      })();
    },
    logoutAccount: async ({ accountId, cfg }) => {
      return { cleared: false, loggedOut: false };
    },
  },
};
