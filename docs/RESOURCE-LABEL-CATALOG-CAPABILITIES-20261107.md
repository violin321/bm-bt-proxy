# 资源标签目录能力核对（2026-11-07）

本次仅做只读检查，没有修改应用、源配置或排序规则，没有触发 Jackett 资源站点搜索。

## AVDB：当前数据库分类可以完整枚举

- 已部署源码 `/app/app/api/services/article_service.py` 的 `get_category` 对文章的 website、section、category 分组统计。
- 磁链查询 `get_torrents` 直接返回文章的 `category`，因此目录中的分类可对应到磁链结果的 category 字段。
- 对部署数据库以 SQLite `mode=ro` 读取，查得 **338 种非空 category 原始值**，包括“国产无码”“无码破解”“有码高清”“无码流出”“8K”等。这是当前数据库已有分类的全集，不代表所有未来可能出现的标签。
- `GET /api/v1/articles/categories` 存在，但当前 BM-BT 源的请求头访问返回 401。已部署路由要求 `get_current_user`；磁链接口使用 `api_key_or_jwt`，认证要求不同。
- 因此可以通过有权限的分类接口或专用只读桥接提供目录，不能假定磁链 API Key 同时拥有分类读取权限，也不应为此向公网开放数据库。

## 修仙：有目录接口，尚未取得目录内容

- 部署服务的 OpenAPI 包含 `GET /api/v1/articles/categories`。
- 用当前 BM-BT 源请求头访问返回 401。
- 未检查其数据库和具体实现，不能承诺与 AVDB 的分类范围及返回字段完全一致。

## Jackett / Knaben：可读取声明的分类目录

- 对当前配置的 Knaben 调用 Torznab `t=caps` 返回 200，得到标准分类、子分类和站点自定义分类的 ID/名称。
- 该请求是元数据读取，不是 `all` 搜索；没有切换生产选择的 Knaben。
- 目录表示站点声明支持的分类，不保证每类当前存在资源，也不等于资源 `Label` / `Genres` 的全部可能值。
- Jackett 官方源码将资源 Category IDs 映射为标准名称并以逗号连接成 `CategoryDesc`，Label/Genres 独立。自定义分类并非都能映射到 CategoryDesc，后续应保留分类 ID 并按 ID 匹配，不能直接承诺当前完整字符串规则适用于每个目录项。
- 已部署镜像标签版本：v0.24.2856-ls5。

## DB Online：影片风格不能作为完整磁链标签目录

- 现有适配器仅暴露磁链查询，没有完整资源标签目录接口。
- 此前检查的 `/api/options/categories` 是影片风格数据；不能据此认为已经拿到“字幕、破解、LTX、LADA”等磁链标签全集。
- 尚未核实其完整资源标签枚举能力。

## 当前应用与后续设计

v1.6.0 的资源标签库仅累计成功搜索结果中观察到的标签；本次没有把上述目录接入生产。

合理的扩展方式是：优先读取各源可用目录，再用搜索中发现的标签补充；区分“当前库完整分类”“上游声明分类”“搜索发现标签”和“无权限读取”，并保持排序规则与真实资源字段或分类 ID 一致。

只读检查脚本位于忽略目录 `.preview-data/release/labels_catalog_*.py`，不含凭据输出。
