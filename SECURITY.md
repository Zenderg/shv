# Security

shv is designed for trusted local and LAN/VPN use. It has no built-in user accounts, passwords, roles, or multi-user authorization.

Do not expose the application directly to the public internet. If you put it behind a reverse proxy, VPN, or remote access layer, that layer is responsible for authentication, authorization, HTTPS, and network access controls.

## Browser Extension Permissions

The optional Chromium helper extension uses broad permissions, including `<all_urls>`, `webRequest`, and `cookies`, so it can observe media requests from pages the user explicitly opens through shv and pass the selected source context back to the local app.

The extension is intended for local installation by the person running shv. Review the source before installing it, and install it only in browser profiles where those permissions are acceptable.

## Cookies

When the user explicitly clicks `Use source`, the extension collects cookies related to the source page, current page URL, selected media URL, and all media candidate URLs in the current source session, then sends them to the shv app origin embedded in the downloaded extension package. The backend stores them in the configured app data folder so download tools can retry selected sources with the same browser context.

Do not share `./data/app`, `youtube-cookies.txt`, exported logs, screenshots, or the SQLite database publicly.

## Supported Use

Use shv only for content you own, created, are allowed to download, or are otherwise legally permitted to save. shv does not support DRM bypass, key extraction, paywall bypass, or circumvention of protected media systems.

## Reporting Issues

If you find a security issue, please open a private report through GitHub security advisories when available, or contact the repository owner directly.
