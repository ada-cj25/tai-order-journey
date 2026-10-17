"""Store a DeepSeek key locally without echoing it or putting it in shell history."""
import getpass
import os
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / '.env.customer-demo'
if not target.exists() or target.is_symlink():
    raise SystemExit('请先创建本地 .env.customer-demo 配置文件；不接受符号链接。')
key = getpass.getpass('粘贴 DeepSeek API key（输入不回显）：').strip()
if not re.fullmatch(r'sk-[A-Za-z0-9_-]{12,}', key):
    raise SystemExit('密钥格式无效，未修改文件。')
text = target.read_text()
values = {'DEEPSEEK_API_KEY': key}
if not re.search(r'^DEEPSEEK_MODEL=.+$', text, re.M):
    values['DEEPSEEK_MODEL'] = 'deepseek-flash'
for name, value in values.items():
    pattern = r'^' + name + r'=.*$'
    text = re.sub(pattern, name + '=' + value, text, flags=re.M) if re.search(pattern, text, re.M) else text.rstrip() + '\n' + name + '=' + value + '\n'
os.chmod(target, 0o600)
target.write_text(text)
print('已保存到本地忽略文件。请重启客服 Agent；运行状态页会显示配置情况。尚未验证 API 调用。')
