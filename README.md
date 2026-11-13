# 小米余额（dsh-go 原生插件）

在 dsh-go 输入框上方显示小米 MiMo 账户余额，点开面板看现金 / 赠金 / 可用授信 / 冻结明细。

仓库：<https://github.com/Whaoe123/dsh-go-mimo-balance> · 许可证 MIT

## 功能

- **状态条**：输入框上方常驻一行「小米余额 ¥500.50」，随语言切换中英文案。
- **余额面板**：总可用 + 现金余额 / 赠送余额 / 可用授信 / 授信额度 / 冻结金额 / 账户状态，带手动刷新。
- **口径清晰**：总可用 = 现金 + 赠送 + 可用授信（已加回冻结部分），面板底部给出拆分说明，不会出现「总可用比明细加起来多」的疑问。
- **低余额预警**：自有余额（现金 + 赠送）低于 5 元时状态条转为警示色；账户不可用时转为异常色。
- **失败可读**：无密钥 / 密钥无效 / 限流 / 超时 / 网络异常 / 接口结构变化，分别给出不同文案与处理建议。
- **不吃额度**：60 秒缓存 + 同时只发一个请求；状态条 5 分钟轮询一次，面板打开期间每分钟跟随缓存刷新。

## 安装

### 从市场安装（推荐）

在 dsh-go 插件市场搜索「小米余额」，或直接命令行安装：

```bash
dsh package install plugin:Whaoe123/dsh-go-mimo-balance@0.2.0 --yes
```

装好后在 App「引擎」页重启引擎即可看到状态条。

### 手动安装

1. 解压到 `~/.dsh/dsh-go/plugins/local-mimo-balance`
2. `dsh plugin --profile web add ~/.dsh/dsh-go/plugins/local-mimo-balance`
3. 在 App「引擎」页重启引擎后生效。

## 卸载

```bash
dsh plugin --profile web remove local-mimo-balance
rm -rf ~/.dsh/dsh-go/plugins/local-mimo-balance
```

## 配置密钥

插件本身不含任何密钥。按下面任一方式提供**小米开放平台普通 API Key**（`sk-` 开头）：

- 写进 `~/.dsh/.credentials.yaml`（或 `.credentials.yml`）：

  ```yaml
  CUSTOM_XIAOMIMIMO_API_KEY: sk-xxxxxxxxxxxxxxxx
  ```

- 或设置同名环境变量 `CUSTOM_XIAOMIMIMO_API_KEY`（优先级高于文件）。

没有密钥时状态条显示「小米余额 —」，不会报错，也不会阻塞输入。

### 可选环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CUSTOM_XIAOMIMIMO_API_KEY` | 无 | API Key，优先于凭据文件 |
| `MIMO_BALANCE_POLL_MS` | `300000` | 状态条轮询间隔（毫秒） |
| `MIMO_BALANCE_WARN_BELOW` | `5` | 自有余额低于该值时预警 |
| `MIMO_BALANCE_URL` | 官方接口 | 仅用于调试或私有网关，一般不用改 |
| `DSH_HOME` | `~/.dsh` | 凭据文件所在目录 |

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 状态条显示「小米余额 —」，面板显示「未配置密钥」 | 没读到 key：确认 `~/.dsh/.credentials.yaml` 里的键名是 `CUSTOM_XIAOMIMIMO_API_KEY`，或环境变量已生效；改完重启引擎 |
| 面板显示「密钥无效」 | 401/403：确认用的是**普通 API Key（sk-）**而不是控制台的登录凭据；确认账户状态正常 |
| 面板显示「请求过于频繁」 | 429：调大 `MIMO_BALANCE_POLL_MS`，或稍后手动刷新 |
| 面板显示「请求超时」「网络异常」 | 本机网络 / 代理问题；可先用下面的 curl 自测 |
| 面板显示「接口地址无效」 | 404：接口路径变更，检查 `MIMO_BALANCE_URL` 或升级插件 |
| 面板显示「响应格式异常」 | 返回结构变化，欢迎反馈 |
| 面板数字长时间不变 | 面板每分钟刷新一次；也可点「刷新」强制拉取 |

### 自测接口

```bash
curl -s https://api.xiaomimimo.com/v1/platform/balance \
  -H "Authorization: Bearer $CUSTOM_XIAOMIMIMO_API_KEY"
```

正常返回示例：

```json
{
  "object": "balance",
  "is_available": true,
  "balance_infos": [{
    "currency": "CNY",
    "cash_balance": "100.50",
    "gift_balance": "20.00",
    "frozen_balance": "0.00",
    "credit_limit": "500.00",
    "credit_available": "380.00",
    "total_available": "500.50"
  }]
}
```

## 隐私

- 只读取 `~/.dsh/.credentials.yaml`（或 `.credentials.yml`）中的 `CUSTOM_XIAOMIMIMO_API_KEY` 一项，不做全文件上传。
- API Key 只作为 `Authorization: Bearer` 头发往 `https://api.xiaomimimo.com`；不写日志、不落地、不外传。
- 余额数据只存在于引擎内存与本地面板渲染，不做持久化。

## 更新记录

- **0.2.0**
  - 面板补「可用授信 / 授信额度」，余额口径与官方定义对齐，并给出「自有 + 可用授信」拆分说明
  - 低余额预警改按自有余额（现金 + 赠送）判断，避免授信抬高总可用后永远不报警
  - 错误分类：无密钥 / 401/403 / 429 / 超时 / 网络 / 404 / 结构异常，面板与刷新提示分别给出处理建议
  - 面板打开期间每分钟自动刷新，数字不再「冻住」
  - 凭据解析改为行首锚定，修掉 yaml 换行写法可能误读下一行的问题；兼容 `.yml`
  - 金额按 `currency` 取符号，海外账号不再统一显示 ¥
  - 轮询间隔、预警阈值可通过环境变量调整
- **0.1.0** 首个版本：状态条 + 余额面板
