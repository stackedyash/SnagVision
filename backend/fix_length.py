import re

with open('models/database.py', 'r') as f:
    content = f.read()

content = re.sub(r'Column\(String,', 'Column(String(255),', content)
content = re.sub(r'Column\(String\(255\), primary_key=True', 'Column(String(36), primary_key=True', content)

with open('models/database.py', 'w') as f:
    f.write(content)

print('Done')