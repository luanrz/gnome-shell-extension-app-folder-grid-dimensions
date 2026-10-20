# Gnome Shell Extension - App Folder Grid Dimensions

GNOME 应用文件夹网格每页的行列数由上游写死为 3 行 × 3 列 = 9 个图标，
这个扩展把它们开放成两个设置项，默认 4 行 × 6 列 = 24 个图标。
它只作用于应用文件夹网格（App Folder Grid），启动器网格（App Grid）不受影响。

## 安装

```sh
git clone https://github.com/luanrz/gnome-shell-extension-app-folder-grid-dimensions.git
cd gnome-shell-extension-app-folder-grid-dimensions
make install
```

装完注销再登录一次，然后在「扩展」应用里启用，或用命令行：

```sh
gnome-extensions enable app-folder-grid-dimensions@luanrz
```

## 设置

「扩展」应用里本扩展的设置窗口中有 `Rows` / `Columns` 两个配置：

| 设置            | dconf 键  | 默认 | 范围 | 说明                 |
| --------------- | --------- | ---- | ---- | -------------------- |
| Rows（行数）    | `rows`    | 4    | 3–12 | 每页行数，上游写死 3 |
| Columns（列数） | `columns` | 6    | 3–12 | 每页列数，上游写死 3 |

行数 × 列数 就是一页的容量，应用文件夹网格宽度与应用图标大小等数据会基于行列数自动计算。

## 其它文档

兼容性、命令行读改设置、排查、尺寸怎么推导、开发，以及每一处补丁为什么存在——都在
[docs/GUIDE.md](docs/GUIDE.md)。

本仓库的所有代码与文档都由 AI 生成（DeepSeek、Qwen 等），没有一行是手写的。
