# koishi-plugin-wowsreplay-to-video

这个插件的立项原因很简单：

常用的QQ官方认证的机器人（例如Kokomi、Yuyuko，当然没有贬低这些开发者的意思，我只是做功能补充，不然也不会有这个项目）没有回放文件转视频此功能

而自己搭建的QQ机器人能实现上传文件生成视频，又很容易被腾讯封

所以说我就写了这个插件来曲线实现（因为是发送文件直链链接）wowsreplay文件转视频的功能

## 功能

- 发送 `.wowsreplay` 文件（仅支持wg服，Lesta服务器的文件数据结构不一样） URL，机器人下载后经过渲染为视频

## 安装

1. **安装 Koishi 和所需插件**  
   确保已经安装此项目必要的插件：
   - `koishi-plugin-http`

2. **安装依赖**  
   这个插件仅作用于前端下载wowsreplay以及回复视频使用
   渲染视频所需要的组件需要自己通过项目“[Minimap Renderer](https://github.com/WoWs-Builder-Team/minimap_renderer "Minimap Renderer")”搭建渲染器。

   - **Minimap Renderer**：解析《战舰世界》的`.wowsreplay`文件，创建类似于游戏中小地图的延时视频。


## 配置

上一步搭建完成后
把渲染器所用的虚拟python环境的路径写入到后台并重载插件

默认路径为 `D:/wows/renderer/venv/Scripts/python.exe`（Windows系统）


## 命令

### `replay <fileUrl>`
- **参数**：
  - `fileUrl`（必填）：`.wowsreplay` 文件的 URL。

- **别名**：
  - `复盘`

### 示例用法
  
  ```bash
  replay https://example.com/replay.wowsreplay
  ```
或者

   ```bash
  复盘 https://example.com/replay.wowsreplay
  ```


## 关于直链

 自建的wowsreplay直链系统，可通过这个来处理直链问题，详情见网页使用说明
 https://wowsreplay.mihoyo.su/
 上传wowsreplay文件，等待上传完毕后使用指令发送链接，例如：
   ```bash
  复盘 http://wowsreplay.mihoyo.su/uploads/file_673ed6b8459569.52179771.wowsreplay
  ```
这样就能渲染视频然后回复了
 

## 安全与开发验证

- `pythonPath` 请填写 Python 可执行文件的路径，无需添加引号，也不要填写 shell 命令或额外参数。带空格的路径可直接使用。
- 每次请求会在系统临时目录创建独立工作目录，使用固定的本地文件名；下载、渲染结束或失败后会清理该目录及附属文件。
- 文件链接仅接受 HTTP(S)，以 URL 路径的 `.wowsreplay` 后缀判断类型，支持查询参数。此限制不等同于目标主机访问控制，请仅向可信用户开放此命令，并限制运行环境的网络访问。

开发验证（Node.js 18.17+）：

```bash
npm ci
npm run typecheck
npm test
```

测试使用模拟 HTTP 下载和渲染器，并在 POSIX 系统执行真实的无害子进程，验证命令替换不会执行、带空格的程序路径可用、并发请求互不覆盖以及错误路径清理。Windows 上跳过 POSIX 子进程用例，其余参数和生命周期测试仍会运行。实际 Minimap Renderer 的视频质量和部署环境需另行验证。
