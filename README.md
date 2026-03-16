# 合同差异对比工具

一款基于 AI 的合同差异分析工具，支持上传两份合同文件（Word / PDF），自动识别并高亮显示重大差异，并可将报告下载为可编辑的 HTML 文件。

---

## 功能特性

- 支持 `.docx` / `.pdf` 格式合同文件
- AI 驱动的逐条差异分析（新增 / 缺失 / 已修改 / 基本一致）
- 差异报告可在线编辑（修改描述、删除条目、新增条目）
- 一键下载完整 HTML 报告，下载后仍可继续编辑和保存
- 支持关键词搜索、按状态筛选、重大差异筛选

---

## 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Python | 3.8 或以上 |
| pip | 任意版本 |

---

## 快速启动

### 方法一：使用启动脚本（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/buthi/contract-compare-tool.git
cd contract-compare-tool

# 2. 一键启动（自动安装依赖）
chmod +x start.sh
./start.sh
```

启动后访问：**http://localhost:5000**

---

### 方法二：手动启动

```bash
# 1. 克隆仓库
git clone https://github.com/buthi/contract-compare-tool.git
cd contract-compare-tool

# 2. 安装 Python 依赖
pip install -r requirements.txt

# 3. 创建上传目录
mkdir -p uploads

# 4. 启动服务
python3 app.py
```

启动后访问：**http://localhost:5000**

---

## 使用方法

1. 打开浏览器，访问 `http://localhost:5000`
2. 上传**参考合同**（左侧）和**目标合同**（右侧）
3. 点击「开始对比」，等待 AI 分析完成
4. 在结果页面查看差异列表，点击任意条目查看详情
5. 点击「进入编辑模式」可修改差异描述、删除或新增条目
6. 点击「⬇ 下载报告 HTML」导出完整报告
7. 下载的 HTML 文件可在浏览器中直接打开，支持继续编辑和再次下载

---

## 项目结构

```
contract-compare-tool/
├── app.py              # Flask 后端主程序
├── requirements.txt    # Python 依赖列表
├── start.sh            # 一键启动脚本
├── public/
│   └── contract.html   # 前端单页面应用
└── uploads/            # 上传文件临时目录（自动创建）
```

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 返回前端页面 |
| POST | `/api/compare` | 上传两份合同，返回差异 JSON |
| GET | `/health` | 健康检查 |

### `/api/compare` 请求示例

```bash
curl -X POST http://localhost:5000/api/compare \
  -F "reference=@合同A.docx" \
  -F "target=@合同B.docx"
```

---

## 常见问题

**Q: 启动后访问页面空白？**  
A: 确认 `python3 app.py` 已正常运行，无报错输出。检查端口 5000 是否被其他程序占用，可用 `lsof -i:5000` 查看。

**Q: 安装依赖报错？**  
A: 尝试使用 `pip3 install -r requirements.txt` 或在虚拟环境中安装：
```bash
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python3 app.py
```

**Q: 下载的 HTML 报告打开后没有内容？**  
A: 请使用 Chrome / Edge / Firefox 浏览器直接打开下载的 `.html` 文件，不要用文本编辑器预览。

**Q: 想修改默认端口？**  
A: 启动时设置环境变量：
```bash
PORT=8080 python3 app.py
# 或
PORT=8080 ./start.sh
```

---

## 技术栈

- **后端**：Python 3 + Flask
- **文档解析**：python-docx（Word）、pdfplumber + PyMuPDF（PDF）
- **AI 分析**：内置差异对比算法（difflib）+ 规则引擎
- **前端**：原生 HTML / CSS / JavaScript（无框架依赖）
