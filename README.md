# clawd-gateway-wework

WorkWeixin (Enterprise WeChat / WeCom) channel plugin for [Clawdbot](https://github.com/nicewang/clawdbot).

This plugin enables Clawdbot to receive and respond to messages from Enterprise WeChat (企业微信/WeCom).

## Features

- Webhook callback verification (GET request handling)
- Message encryption/decryption (AES-256-CBC)
- XML message parsing
- Agent dispatch and reply handling
- Text message sending via WeChat Work API
- Account configuration management
- Pairing approval flow for user authorization

## Installation

### Option 1: Install as Extension (Recommended)

Clone or copy this repository into your Clawdbot extensions directory:

```bash
cd /path/to/clawdbot/extensions
git clone https://github.com/nicewang/clawd-gateway-wework.git workweixin
```

Or manually copy the files:

```bash
mkdir -p /path/to/clawdbot/extensions/workweixin
cp -r /path/to/clawd-gateway-wework/* /path/to/clawdbot/extensions/workweixin/
```

### Option 2: Symlink for Development

For development or testing, you can symlink the repository:

```bash
cd /path/to/clawdbot/extensions
ln -sf /home/ubuntu/clawd-gateway-wework workweixin
```

## Configuration

Add the following to your Clawdbot configuration file (`~/.clawdbot/config.yaml` or equivalent):

```yaml
channels:
  workweixin:
    enabled: true
    corpId: "your-corp-id"
    corpSecret: "your-corp-secret"
    agentId: "your-agent-id"
    token: "your-callback-token"
    encodingAESKey: "your-encoding-aes-key"
    dmPolicy: "pairing"  # or "open" or "closed"
    allowFrom:
      - "user1"
      - "user2"
```

### Configuration Fields

| Field | Description | Required |
|-------|-------------|----------|
| `corpId` | Enterprise WeChat Corp ID | Yes |
| `corpSecret` | Application Secret | Yes |
| `agentId` | Application Agent ID | Yes |
| `token` | Callback verification token | Yes |
| `encodingAESKey` | Message encryption key (43 chars) | Yes |
| `dmPolicy` | DM access policy: `open`, `closed`, or `pairing` | No (default: `pairing`) |
| `allowFrom` | List of allowed user IDs (for `pairing` policy) | No |

## WeChat Work Setup

1. Log in to [WeChat Work Admin Console](https://work.weixin.qq.com/)
2. Go to **Application Management** → **Create Application** (or use existing)
3. Note the `AgentId` from the application details
4. Go to **Application Details** → **API Receive Messages**
5. Set the callback URL to: `https://your-domain/webhooks/workweixin`
6. Generate and copy the `Token` and `EncodingAESKey`
7. Get your `CorpId` from **My Enterprise** → **Enterprise Information**
8. Get the `Secret` from your application's details page

## Webhook Endpoint

The plugin registers a webhook at:

```
GET/POST /webhooks/workweixin
```

- **GET**: Handles callback URL verification from WeChat Work
- **POST**: Receives and processes incoming messages

## User Authorization

With `dmPolicy: "pairing"` (default), users must be approved before they can send messages:

```bash
# Approve a user
clawdbot channels approve workweixin <userId>

# List pending approvals
clawdbot channels pending workweixin
```

When approved, users receive a notification in Chinese:
> 配对已批准！您现在可以通过企微向Clawdbot发送消息。

## Directory Structure

```
clawd-gateway-wework/
├── package.json           # Package manifest
├── README.md              # This file
├── clawdbot.plugin.json   # Plugin manifest
├── index.ts               # Main plugin entry with webhook handler
└── src/
    ├── channel.ts         # Channel plugin implementation
    └── runtime.ts         # Runtime accessor
```

## Supported Message Types

Currently supported:
- Text messages

Not yet supported:
- Image messages
- Voice messages
- Video messages
- File messages
- Location messages
- Link messages

## Troubleshooting

### Callback verification fails
- Ensure `token` and `encodingAESKey` match your WeChat Work settings exactly
- Check that the URL is accessible from WeChat servers
- Verify HTTPS is properly configured

### Messages not received
- Check Clawdbot logs for errors
- Verify the application is enabled in WeChat Work
- Ensure the user is within the application's visible scope

### Reply not sent
- Verify `corpId`, `corpSecret`, and `agentId` are correct
- Check API access token retrieval in logs
- Ensure the user is within the application's send scope

## License

MIT
