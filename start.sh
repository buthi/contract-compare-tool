#!/usr/bin/env bash
# 合同差异对比服务启动脚本
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 Python
if ! command -v python3 &>/dev/null; then
  echo "❌ 未找到 python3，请先安装 Python 3.8+"
  exit 1
fi

# 安装依赖（如未安装）
if ! python3 -c "import flask" &>/dev/null 2>&1; then
  echo "📦 正在安装依赖..."
  pip install -r requirements.txt
fi

# 创建上传目录
mkdir -p uploads

PORT="${PORT:-5000}"
echo "🚀 启动合同差异对比服务，端口: $PORT"
echo "🌐 访问地址: http://localhost:$PORT"
echo "📄 前端页面: http://localhost:$PORT/"
echo "🔌 API 端点: http://localhost:$PORT/api/compare"
echo ""

python3 app.py
