# 文档版本接入：第一子批

本分支仅实现原生协作保存与固定快照的同事务记录。尚未实现向 Gitea（版本平台）发送提交、账号与空间仓库映射、前端历史列表或旧版恢复。
基线为 Docmost（协作文档系统）0.96.0，提交 9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af。

## 行为
- 保存失败重新抛出，不广播成功，也不提前发送页面更新事件；失败批次的贡献者留待重试。
- 正文或协同二进制状态发生变化，都进入保存；只有两者相同才跳过。
- 开启捕获时，正文与快照记录在同一数据库事务中；失败一起回滚。
- 快照保存页面元信息、原生正文、协同二进制状态、本批作者和内容摘要。
- 作者必须属于页面工作空间；不接受用旧编辑人冒充本批作者。
- 已保存快照禁止修改和逐行删除；删除页面不会级联删除快照。
- 暂存记录默认待同步，不代表已经提交到版本仓库。
- 本批没有逐按键持久日志，不保证未落库编辑窗口能在进程崩溃后恢复。
- 评论历史、附件文件本体、动态引用不在本批范围；不得把此快照当成完整媒体回放。

## 配置
默认关闭，现有部署不受参数改变影响。只有独立测试环境验证通过后，才按正式变更流程开启。
```dotenv
SOP_VERSION_CAPTURE_ENABLED=false
SOP_VERSION_DEBOUNCE_MS=5000
SOP_VERSION_MAX_DEBOUNCE_MS=30000
```
开启时停笔一至六十秒、连续编辑最长一至三百秒；最大等待不得小于停笔间隔。关闭时保留上游十秒/四十五秒。
数据库迁移文件为 `20261001T120000-sop-page-versions.ts`（快照表迁移）。开发环境按原项目迁移流程执行；不要手动在已有运行库试验。

## 测试
使用与基线一致的 Node.js（脚本运行环境）26 和 pnpm（依赖管理器）11.25.0，冻结锁文件安装依赖，并先构建编辑扩展及公式包。
在独立 PostgreSQL（关系型数据库）中新建专用测试库 `sop_capture_test`（捕获测试库）；只向测试进程提供连接地址，不提交密码。
```sh
export SOP_CAPTURE_TEST_DATABASE_URL='postgres://USER:PASSWORD@TEST_HOST:5432/sop_capture_test'
cd apps/server
pnpm exec jest --runInBand --runTestsByPath \
  src/integrations/versioning/versioning.config.spec.ts \
  src/integrations/versioning/version-snapshot.spec.ts \
  src/integrations/versioning/versioning.regressions.spec.ts \
  src/integrations/versioning/version-capture.integration.spec.ts \
  src/collaboration/extensions/persistence.versioning.spec.ts
pnpm build
```
命令中的连接地址仅为占位示例，必须替换为独立测试库。数据库测试使用随机模式，只清理它自身创建的测试模式。
未设置测试连接时，数据库专项会被跳过；不能据此声称真实数据库验收通过。
本批专项覆盖事务回滚、快照不串版、并发版本号、作者归属、错误保存广播、重试贡献者和历史不可变约束。

## 回退与后续
关闭捕获即可停止新增任务；已有快照保留。回退迁移遇到非空表会拒绝执行，避免丢历史。
后续发送器只允许更新任务投递状态，不能改原始快照；需要单仓串行、固定请求编号、远端冲突保护和响应丢失后的去重。
增加历史界面前，必须落实逐页授权、固定素材读取和失效提示，不能仅因为能读取数据库记录就开放给所有空间成员。
