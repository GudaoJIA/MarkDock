# MarkDock

[English](README.md) | **简体中文**

**用浏览器编辑真实的 Markdown 文件。**

MarkDock 是一个单用户 Markdown 工作区。将已有文件夹固定为工作区，即可编辑文档、管理图片附件；文件始终保存在运行服务的设备上，无需导入或导出。

## 能做什么

- 在可视化与源码模式间切换，共用撤销历史与自动保存。
- 搜索、创建、移动和重命名文档，通过垃圾箱恢复误删文件。
- 按工作区设置图片与附件的存放方式，按需查看资源文件。
- 使用文档大纲、查找替换、写作目标及自定义快捷键。
- 选择中文或英文界面，以及浅色、深色或跟随系统外观。

## 开始使用

| 你的目标 | 从这里开始 |
| --- | --- |
| 在电脑或服务器上安装 | [部署说明](docs/ZH/01-deployment.md) |
| 第一次打开工作区 | [快速上手](docs/ZH/02-getting-started.md) |
| 调整目录、资源和偏好 | [配置说明](docs/ZH/03-configuration.md) |
| 了解编辑与文件管理 | [使用指南](docs/ZH/04-user-guide.md) |
| 备份、升级或恢复数据 | [备份与恢复](docs/ZH/05-backup-and-recovery.md) |
| 解决使用中的问题 | [故障排查](docs/ZH/06-troubleshooting.md) |

完整导航见[用户文档](docs/ZH/README.md)。

## 部署方式与边界

支持源码启动，以及通过仓库中的 Dockerfile 和 Compose 构建运行。**目前尚未发布官方 Docker Hub 镜像。** 源码需要 Node.js 22、Bun 1.3.3；完整命令见部署说明。

默认仅监听本机地址。服务器访问采用单用户密码登录及显式配置的 HTTPS 反向代理；不提供注册、多人协作、云同步或内置 AI。工作区路径属于服务所在设备，不是浏览器设备。

Markdown、资源和工作区配置直接保存在磁盘。自动保存与垃圾箱不能替代独立备份；关闭页面会丢失内存中的撤销历史，未保存内容也不保证恢复。

## 来源与许可

基于 [Plate Playground Template](https://github.com/udecode/plate-playground-template) 开发，使用 Plate、Slate、React、Next.js、shadcn/ui 和 Lucide 等开源组件。

保留上游 [MIT 许可证与版权声明](LICENSE)。第三方依赖遵循各自许可证。
