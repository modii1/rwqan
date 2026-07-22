#!/bin/bash

# الملف الحالي للعمل
PROJECT_DIR="$(pwd)"

# الكلمات المفتاحية للبحث
KEYWORDS="key|secret|token|password|api"

echo "🔍 جاري فحص المشروع عن المفاتيح والأسرار في $PROJECT_DIR ..."

# البحث في كل الملفات باستثناء node_modules و .git
FOUND=false
while IFS= read -r line; do
    echo "$line"
    FOUND=true
done < <(grep -rInE --exclude-dir={node_modules,.git} "$KEYWORDS" "$PROJECT_DIR")

if [ "$FOUND" = false ]; then
    echo "✅ الفحص اكتمل ولم يتم العثور على مفاتيح أو أسرار."
else
    echo "⚠️ تم العثور على محتوى يحتمل أنه مفاتيح/أسرار. تحقق من النتائج أعلاه."
fi
