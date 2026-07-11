# 桌面签名、公证与原生 CI

GitHub Actions 在各自原生 runner 上构建 Apple Silicon macOS、Intel macOS、Windows x64、Linux x64 和 Linux ARM64。每个平台都会先执行完整后端验证。

## Apple 签名与公证

在仓库 Actions secrets 中配置：

- `APPLE_CERTIFICATE`：Base64 编码的 Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`：app-specific password
- `APPLE_TEAM_ID`

Tauri action 会导入证书、签名 `.app` 和 DMG，并提交 Apple notarization。任一公证凭据缺失时仍构建未公证安装包，并在日志中明确警告。

## Windows Authenticode

配置：

- `WINDOWS_CERTIFICATE`：Base64 编码 PFX
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_CERTIFICATE_THUMBPRINT`
- `WINDOWS_TIMESTAMP_URL`：可选，默认 DigiCert RFC3161 服务

workflow 把 PFX 临时导入当前 runner 用户证书库，构建完成后由 `scripts/sign-windows.ps1` 使用 SHA-256、RFC3161 时间戳和 `signtool verify /pa` 验证。没有证书时脚本退出成功但明确标记为 unsigned。

## 构建来源证明

每个 runner 对 tauri-action 返回的安装包路径生成 GitHub artifact provenance attestation。发布仍为 draft，维护者应检查签名状态、安装测试和校验信息后再公开。

## 不能放进代码库的内容

真实证书、密码、Apple app-specific password 和私钥不能生成或提交到仓库。它们必须由项目所有者从 Apple Developer、受信任 Windows CA 或企业签名服务取得。
