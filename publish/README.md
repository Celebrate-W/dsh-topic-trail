# 发布到 DSH 插件市场（awesome-dsh-plugin）

本目录是**投稿素材**，不属于插件运行所需文件（已在打包 `files` 之外）。

---

## 目标

插件上架后会自动出现在这些地方（数据源都是 `awesome-dsh-plugin`）：

- [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) — 官方目录站
- [dshmarket.com](https://dshmarket.com) — 市场 App（本地装的 `@linxin666/dsh-client-ui-market` 就是它的 GUI 客户端）
- 以及多个二级市场（加了 `dsh-plugin` topic 后会由爬虫自动收录）

## 当前状态

| 项目 | 状态 |
|---|---|
| GitHub 公开仓库 | ✅ https://github.com/Celebrate-W/dsh-topic-trail |
| 仓库 topic `dsh-plugin` | ✅ 已加（爬虫识别入口） |
| `package.json` 的 `dsh.bundle` manifest | ✅ 指向 `cordis.patch.yml` |
| `author` / `repository` 字段 | ✅ 已补 |
| `peerDependencies` 声明 | ✅ 已补 `@deepseek-ai/dsh-client-runtime` / `@deepseek-ai/dsh-llm`（标 optional） |
| 构建产物 `lib/` 提交进仓库 | ✅ 有（这条常被忽略，缺了用户装完会崩） |
| README 含可复制安装命令 | ✅ 有 |
| npm 包 | ⬜ **未发布**（`dsh-topic-trail` 这个名字在 npm 上未被占用） |
| 投稿 PR | ⬜ **未提交** |

## 投稿步骤（剩下的两步）

**1. 发 npm 包**（可选但推荐——用户安装更快，不用从 GitHub 源码构建）

```sh
cd <本插件目录>
npm publish --access public
```

> 前提：`repository` 字段必须指回 GitHub 仓库（已配好）。registry 用它做防抢注校验，缺了 npm 映射挂不上。

**2. 向 awesome-dsh-plugin 提 PR**

```sh
git clone https://github.com/<你的账号>/awesome-dsh-plugin
cd awesome-dsh-plugin
# 新建分支
git checkout -b add-dsh-topic-trail
# 把 awesome-dsh-plugin-entry.yml 复制成规范文件名
cp <本目录>/awesome-dsh-plugin-entry.yml data/plugins/Celebrate-W__dsh-topic-trail.yml
git add data/plugins/Celebrate-W__dsh-topic-trail.yml
git commit -m "Add Celebrate-W/dsh-topic-trail"
git push origin add-dsh-topic-trail
```

然后在 GitHub 上开 PR。

**⚠️ 只加这一个文件**：两个 README 由脚本生成，**不要手工编辑**（contributing.md 明确写了）。
合并后会自动重新生成，你不需要跑任何命令。

## 条目格式说明

`awesome-dsh-plugin-entry.yml` 的字段（依据 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）：

```yaml
url: https://github.com/owner/repo    # 必须与仓库完全一致
name: owner/repo                      # 列表里显示的链接文字
category: ui                          # 分类，插件市场里 ui 类有 29 个
description:
  en: 'One-line description ending with a period.'   # 必填
  zh: '一句话描述，以句号结尾。'                        # 可选，维护者会补
```

**注意**：
- 描述里含 **半角** `: `（冒号+空格）**必须加引号**，否则 YAML 解析失败（中文全角冒号无此问题）
- 描述要**与代码逐条对得上**，不要写营销词，否则会被打回
- `tarball:` 可选（指向 GitHub Release 的 `.tgz`），用于不发 npm 的情况

## 关于内置头像的提醒

插件里内置的「鲸鱼娘」头像是社区二创（上游 **CC BY-NC-SA 4.0**，**禁止商业使用**），
详见仓库根目录的 [THIRD-PARTY.md](../THIRD-PARTY.md)。

**上架市场本身没问题**（免费分发），但**不要用它做商业变现**（平台创作激励、广告、付费分发等）。
如果将来需要商用，请改用自己拥有授权的素材，或只用默认皮肤（经典蓝球）。
