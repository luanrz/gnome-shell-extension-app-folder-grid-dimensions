# GNOME Shell Extension - App Folder Grid Dimensions

简体中文 | [English](README.en.md)

GNOME 应用文件夹弹窗里的网格，每页的行列数由上游写死为 3 行 × 3 列 = 9 个图标，
这个扩展把它们开放成两个设置项，默认 4 行 × 6 列 = 24 个图标。
它只调整应用文件夹网格（App Folder Grid）与弹窗尺寸；启动器网格（App Grid）不受影响。

## 安装

```sh
git clone https://github.com/luanrz/gnome-shell-extension-app-folder-grid-dimensions.git
cd gnome-shell-extension-app-folder-grid-dimensions
make install
```

安装完需要注销并重新登录一次；之后在「扩展」应用里启用，或执行下面的命令：

```sh
gnome-extensions enable app-folder-grid-dimensions@luanrz
```

## 设置

在「扩展」应用里打开本扩展的设置窗口，可以看到 `Rows` / `Columns` 两个设置项：

| 设置            | dconf 键  | 默认 | 范围 | 说明                 |
| --------------- | --------- | ---- | ---- | -------------------- |
| Rows（行数）    | `rows`    | 4    | 3–12 | 每页行数，上游写死 3 |
| Columns（列数） | `columns` | 6    | 3–12 | 每页列数，上游写死 3 |

行数 × 列数 就是网格每页的容量；弹窗尺寸、所有文件夹共用的格子边长与图标大小，都由行列数和
当前屏幕推导，屏幕放不下时所有文件夹的格子与图标一起缩小。

## 其它文档

有关此扩展的机制、开发、产物约定、常见问题等进阶使用说明，详见 [docs/GUIDE.md](docs/GUIDE.md)。

本仓库的所有代码与文档都由 AI 生成（DeepSeek、Qwen 等），没有一行是手写的。
