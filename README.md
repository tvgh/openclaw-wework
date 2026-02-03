# clawd-gateway-wework

[Clawdbot](https://github.com/nicewang/clawdbot) 的企业微信（Work Weixin / WeCom）渠道插件。

该插件让 Clawdbot 能够接收并回复来自企业微信（WeCom）的消息。

## 功能特性

- Webhook 回调校验（处理 GET 请求）
- 消息加密/解密（AES-256-CBC）
- XML 消息解析
- Agent 分发与回复处理
- 通过企业微信 API 发送文本消息
- 账号配置管理
- 用户授权的配对审批流程

## 安装

将本仓库 clone 或拷贝到你的 Clawdbot 扩展目录：

```bash
cd /path/to/clawdbot/extensions
git clone https://github.com/nicewang/clawd-gateway-wework.git workweixin
```

## 配置

### 方法 1：使用 CLI 命令（推荐）

使用 `clawdbot config set` 添加企业微信（WorkWeixin）配置：

```bash
# 一次性设置全部配置
clawdbot config set channels.workweixin '{
  "enabled": true,
  "corpId": "your-corp-id",
  "corpSecret": "your-corp-secret",
  "agentId": "your-agent-id",
  "token": "your-callback-token",
  "encodingAESKey": "your-encoding-aes-key",
  "dmPolicy": "pairing"
}' --json
```

也可以分别设置每个字段：

```bash
clawdbot config set channels.workweixin.enabled true --json
clawdbot config set channels.workweixin.corpId '"your-corp-id"' --json
clawdbot config set channels.workweixin.corpSecret '"your-corp-secret"' --json
clawdbot config set channels.workweixin.agentId '"your-agent-id"' --json
clawdbot config set channels.workweixin.token '"your-callback-token"' --json
clawdbot config set channels.workweixin.encodingAESKey '"your-encoding-aes-key"' --json
clawdbot config set channels.workweixin.dmPolicy '"pairing"' --json
```

### 配置字段说明

| 字段 | 说明 | 是否必填 |
|------|------|----------|
| `corpId` | 企业微信 Corp ID | 是 |
| `corpSecret` | 应用 Secret | 是 |
| `agentId` | 应用 Agent ID | 是 |
| `token` | 回调校验 Token | 是 |
| `encodingAESKey` | 消息加密密钥（43 位） | 是 |
| `dmPolicy` | 私聊（DM）访问策略：`open`、`closed` 或 `pairing` | 否（默认：`pairing`） |
| `allowFrom` | 允许的用户 ID 列表（用于 `pairing` 策略） | 否 |

## 企业微信侧配置

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/)
2. 进入 **应用管理** → **创建应用**（或使用已有应用）
3. 在应用详情中记录 `AgentId`
4. 进入 **应用详情** → **接收消息** / **API 接收消息**
5. 将回调 URL 设置为：`https://your-domain/webhooks/workweixin`
6. 生成并复制 `Token` 与 `EncodingAESKey`
7. 在 **我的企业** → **企业信息** 中获取 `CorpId`
8. 应用中的企业可信IP添加服务器的IP
9. 在应用详情页获取 `Secret`
10. 

## 启动 Clawdbot

完成配置后，启动或重启 Clawdbot gateway：

```bash
# 启动 gateway 服务（systemd/launchd）
clawdbot gateway start

# 若已在运行，可重启
clawdbot gateway restart

# 或以前台方式运行（用于调试）
clawdbot gateway run --verbose
```

### 验证渠道是否在运行

```bash
# 列出所有渠道
clawdbot channels list

# 查看渠道状态
clawdbot channels status
```

## Webhook 端点

该插件注册的 webhook 路径为：

```
GET/POST /webhooks/workweixin
```

- **GET**：处理企业微信的回调 URL 校验
- **POST**：接收并处理用户消息

## 用户授权

当 `dmPolicy: "pairing"`（默认）时，用户需要先被批准后才能发送消息：

```bash
# 批准某个用户
clawdbot channels approve workweixin <userId>

# 查看待审批列表
clawdbot channels pending workweixin
```

批准后，用户会收到一条中文通知：
> 配对已批准！您现在可以通过企微向Clawdbot发送消息。

## 目录结构

```
clawd-gateway-wework/
├── package.json           # 包清单
├── README.md              # 本文档
├── clawdbot.plugin.json   # 插件清单
├── index.ts               # 插件入口（包含 webhook 处理器）
└── src/
    ├── channel.ts         # 渠道插件实现
    └── runtime.ts         # 运行时访问器
```

## 支持的消息类型

当前已支持：
- 文本消息

暂未支持：
- 图片消息
- 语音消息
- 视频消息
- 文件消息
- 位置消息
- 链接消息

## 排查问题

### 回调校验失败
- 确认 `token` 与 `encodingAESKey` 与企业微信后台配置完全一致
- 确认该 URL 可被企业微信服务器访问
- 确认 HTTPS 配置正确

### 收不到消息
- 查看 Clawdbot 日志是否有报错
- 确认企业微信端应用已启用
- 确认用户在应用可见范围内

### 发送不出回复
- 确认 `corpId`、`corpSecret`、`agentId` 正确
- 在日志中检查 API access token 的获取过程
- 确认用户在应用可发送范围内

## 许可证

MIT
