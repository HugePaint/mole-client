# 摩尔博物馆（museum.61player.com）资料利用记录

> 来源：用户指引 · 记录日期：2026-06
> 性质：**玩家自制**的摩尔庄园图鉴站（Vue 3 + Element Plus SPA），非官方。
> 价值：暴露了 1234 条 socket 协议的完整解码表，以及 **`ClientSocketDLL` 的反编译 AS3 源码**。

---

## 一、站点结构

| 页面 | 大小 | 内容 |
|---|---|---|
| `/index.html` | 10 KB | 首页：物品图鉴搜索 + 图片搜索 |
| `/socket.html` | 33 KB | **Socket 协议查询**（1234 条） |
| `/map.html` | 64 KB | 地图 |
| `/suit.html` | 32 KB | 套装 |
| `/game.html` | 13 KB | 小游戏重温（托管 `./assets/module/game/*.swf`） |
| `/item.html` | 16 KB | 物品 |
| `/search.html` | 7 KB | 搜索 |

---

## 二、可用接口

| 接口 | 说明 |
|---|---|
| `/api?event=searchsocket&pagesize=N&pageid=P[&keyword=K]` | 协议表查询，返回 `{results:[{ID,note,class,action,static,db}], totalCount}` |
| `/api/command-ids` | opcode → 客户端方法名数组（31.4 KB） |
| `/api/dll-list?path=<目录>` | 列目录下的 `.as` 文件（**只返回文件，不返回子目录**） |
| `/api/dll-source?path=<文件>` | 取单个 `.as` 文件内容 |

> **重要限制**：`dll-list` 不返回子目录名，因此无法从根自动递归。
> 目录清单必须从协议表每行的 `class` 字段反推（见第四节脚本）。

---

## 三、协议表（已存档）

`resources` 之外的原始数据已存：

- `_re/museum/socket_protocol.json` —— 全量 1234 条
- `_re/museum/command-ids.json` —— opcode → 方法名（31.4 KB）

**数据质量远好于 RecMole 的 `cmdlist.lua`**：

| 字段 | 完整度 |
|---|---|
| 总数 | 1234 |
| 有 `class`（AS3 类名） | **1229** |
| 有 `action`（AS3 方法名） | **1228** |
| 有中文备注（非"未知"） | **1232** |

样例：

```
[201   ] action=doAction            class=loginonline.LoginOnlineSreRes          note=登录Online Server
[302   ] action=doAction            class=chat.ChatMsgRes                        note=聊天信息
[303   ] action=doAction            class=walk.WalkMsgRes                        note=走路
[401   ] action=enterMapRoomRes     class=enterMapOrRoom.EnterMapOrRoomRes       note=进入地图
[403   ] action=decode              class=enterGame.EnterGameRes                 note=进入游戏
[426   ] action=res_res_getSID      class=session.BringTagoutLoginSocket         note=根据游戏ID获得登入签登入Session
[3106  ] action=res_askAllNpcJob    class=NPCJob.NpcJobSocket                    note=查询NPC所有任务状态
[10301 ] action=parseServerTimer    class=getServerTimer.getServerTimerRes       note=获取系统时间
```

`/api/command-ids` 还额外给出了**每个 opcode 对应的方法名数组**（同一 opcode 可有多个方法，如
`103: ["getSerListByPage","NEW_LOGIN"]`），可与协议表交叉验证。

---

## 四、反编译源码（已镜像）

`ClientSocketDLL` 的完整包路径是 `com/logic/socket/<dir>/<File>.as`。
从协议表的 `class` 字段反推得到 **288 个唯一目录**（清单：`_re/museum/socket_dirs.txt`）。

镜像脚本：[`tools/mirror-museum-src.js`](../tools/mirror-museum-src.js)

```powershell
node tools\mirror-museum-src.js
# 输出: _re\museum\src\ClientSocketDLL\com\logic\socket\...
```

### 已确认的关键实现

**`com/logic/socket/gameSocket/gameSocket.as`** —— 小游戏 socket，**明文**：

```as3
public function writeHead(tempByteArr:ByteArray = null) : * {
   this.MsgHead.PkgLen   = 17 + tempByteArr.length;
   this.MsgHead.Version  = 1;
   this.MsgHead.UserID   = this.UserID;
   socket.writeUnsignedInt(this.MsgHead.PkgLen);   // 4B 包长（大端）
   socket.writeByte(this.MsgHead.Version);          // 1B 版本（=1）
   socket.writeUnsignedInt(this.MsgHead.Command);   // 4B 命令号
   socket.writeUnsignedInt(this.MsgHead.UserID);    // 4B 米米号
   socket.writeInt(this.MsgHead.Result);            // 4B 结果/序列号
   this.writeOutput();                              // ← 可覆写钩子
   socket.writeBytes(tempByteArr,0,tempByteArr.length);
   socket.flush();
}
```

- 与 `org.taomee.net.SocketImpl` 的 17 字节头规格**完全一致**，交叉验证成立。
- `writeOutput()` / `readOutput()` 是 **protected 钩子**（基类只做 trace）——加密若要介入就在这里覆写。
- `readDates()` 完整实现了**粘包/半包处理**：`bytesAvailable < 17` 就等下次；`PkgLen - 17` 为包体长；
  包体不足时用 `isFinish` + `oldMsgHead` 保存状态续包。
- `Security.loadPolicyFile("xmlsocket://" + ip + ":" + port)` —— 明确从游戏端口取策略文件
  （我们已实测该端口返回 allow-all，与此吻合）。

**`com/logic/socket/ClientGameSerSocket.as`** —— 小游戏服连接，同样**明文**：

```as3
if(MsgHead.PkgLen < 0 || MsgHead.PkgLen > 8192) { ... this.socket.close(); return; }   // 8KB 上限
MsgHead.Version = this.socket.readUnsignedByte();
MsgHead.Command = this.socket.readUnsignedInt();
MsgHead.UserID  = this.socket.readUnsignedInt();
MsgHead.Result  = this.socket.readUnsignedInt();
```
另有 `Result` 错误码语义：`-10001` 未登录、`-10007` 加入游戏失败、`-10021` 走 `ServerMsg`。

**`org/taomee/net/SocketImpl.as`**（本地 `_re/TaomeeLibraryDLL-master` 副本）—— 共用传输层，同样明文：
`PACKAGE_MAX = 8388608`，`cmdID > 1000` 时递增 `_result` 作序列号，`SV_2` 版本头长 21 字节。

---

## 五、⚠️ 该站没有的东西：加密实现

| 目标 | 状态 |
|---|---|
| `ClientCommonDLL` 源码 | ❌ 列表为空、子路径 404 |
| `TaomeeCoreDLL` 源码 | ❌ 同上 |
| `com/fcc`（`MDecrypt`/`MEncrypt` CrossBridge） | ❌ 不可得 |
| `MessageEncrypt` | ❌ 不可得 |

本地 `TaomeeLibraryDLL-master` 共 190 个 `.as` 文件，也**只有 `com/adobe/crypto/MD5.as`**，
没有加密类——说明 `MessageEncrypt` / `com.fcc` 属于游戏专属 DLL，不在共用地基里。

**结论**：摩尔主链路的包体加密密钥仍是唯一未解项。但这**不影响本项目目标**——
我们直连官方服务器，只需透传；解密仅对 Phase 4 抓包可读性与未来自建服有意义。

**可选的下一步**（若将来要做 Phase 4 解密）：
1. 用 JPEXS 反编译 `dll/ClientCommonDLL.swf`，定位 `MessageEncrypt` 的包装类与密钥来源
   （研究阶段已确认密钥流周期 ≈22 字节，非赛尔的 `!crAckmE4nOthIng:-)`）。
2. 或运行时从 Ruffle 内存中读密钥。

---

## 六、包体字段 schema（自动抽取）

镜像源码里每个响应类的 `doAction()`/`decode()` 都是**按线序逐字段**从 `GV.onlineSocket` 读取的：

```as3
// walk/WalkMsgRes.as
walkMessage.UserID = GV.onlineSocket.readUnsignedInt();
walkMessage.EndX   = GV.onlineSocket.readUnsignedInt();
walkMessage.EndY   = GV.onlineSocket.readUnsignedInt();
walkMessage.UseItem= GV.onlineSocket.readUnsignedInt();
walkMessage.Grid   = GV.onlineSocket.readUnsignedInt();
```

因此「read 调用的出现顺序 + 目标属性名」**就是包体字段 schema**。已实现自动抽取：
[`tools/gen-socket-schema.js`](../tools/gen-socket-schema.js) → `resources/socket-schema.json`

```powershell
node tools\gen-socket-schema.js
```

**产出**：441 个 opcode 的字段结构，共 1349 个字段（来自 191 个源文件）。

抽样：

```
[303] 走路 (walk.WalkMsgRes)
    u32 UserID | u32 EndX | u32 EndY | u32 UseItem | u32 Grid      ← 共 20 字节

[201] 登录Online Server (loginonline.LoginOnlineSreRes)
    u32 UserID | utf Nick | u32 ParentID | u32 childCount | ... | u8 ItemCount   ← 45 个字段，完整玩家档案

[302] 聊天信息 (chat.ChatMsgRes)
    u32 ID | utf Nike | u32 Friend | u32 MsgLen | utf MSG

[406] 获取地图信息 (listmapmsg.ListMapMsgRes)
    u32 MapID | u32 MapType | utf Name | u32 type | u32 ItemCount | u32 ID | u32 ItemID | u32 PosX | u32 PosY | u8 Direction | u32 Flag
```

### ⚠️ 精度说明（必须知道）

1. **分支会污染字段表**。若一个 `doAction()` 内含 `switch`/`if` 分支（如 `10003 TextNoticeRes` 按
   `Type` 走不同分支），抽取结果是各分支字段的**串联**，不是单条线性 schema。
   这类 opcode 需人工按 `Type` 拆分。
2. **仅覆盖服务端→客户端方向**（`*Res`）。客户端→服务端（`*Req`）的字段要看对应 `Req` 类。
3. **字段名来自反编译器的局部变量名**，个别会有 `id`/`nickname` 重复，需人工消歧。

### 交叉验证：发现 RecMole 的一处错误

RecMole 的 `gpp.handler[303]` 只读 12 字节（`EndX, EndY, id`），
而 schema 显示真实包体是 **20 字节**（`UserID, EndX, EndY, UseItem, Grid` 五个 u32）。
这是 RecMole 停留在"极初期阶段"的典型表现，说明博物馆数据比它可靠。

---

## 七、对本项目各阶段的价值

| 阶段 | 用途 |
|---|---|
| **Phase 2** 资源全量本地化 | 反编译源码里的资源路径字面量比 ABC 常量池更易读，可用于补全爬取目标 |
| **Phase 4** 网络可观测 | ⭐ **主要价值**：1234 条 opcode 中文备注 + **441 条包体字段 schema**，可直接把 17 字节头解析结果渲染成可读日志 |
| 未来自建服 | 协议表 + Req/Res 类清单，是 RecMole 之外更完整的参考 |

**Phase 4 的实现路径因此明确**：本地 TCP 代理读 17 字节头 →
按 `resources/socket-schema.json` 逐字段解包体 → 用 `resources/socket-opcodes.tsv` 的
中文备注渲染成可读日志。

---

## 八、合规提示

该站为**玩家自制**，明示了免责声明（`showDisclaimer`，拒绝即跳回首页）。
其中的反编译源码属淘米作品的衍生内容。本项目仅将其用于**本地个人研究参考**，
不随客户端分发，也不并入交付物。
