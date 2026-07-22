import { marked } from 'marked';
import { readFileSync, writeFileSync } from 'fs';

const markdown = readFileSync('DEVELOPER_GUIDE.md', 'utf-8');
const htmlContent = marked.parse(markdown);

const fullHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>دليل المطور الشامل - نظام روقـان للعقارات</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      font-size: 14px;
      line-height: 1.8;
      color: #333;
      background: linear-gradient(135deg, #fafaf5 0%, #f5f0e5 100%);
      padding: 40px;
      max-width: 1200px;
      margin: 0 auto;
      direction: rtl;
      text-align: right;
    }

    h1 {
      color: #b88d2b;
      font-size: 32px;
      font-weight: 700;
      border-bottom: 4px solid #b88d2b;
      padding-bottom: 15px;
      margin-top: 50px;
      margin-bottom: 25px;
      background: linear-gradient(90deg, transparent 0%, #fffdf0 50%, transparent 100%);
      padding: 20px;
      border-radius: 10px;
    }

    h2 {
      color: #8b6914;
      font-size: 24px;
      font-weight: 600;
      border-bottom: 3px solid #e0c97b;
      padding-bottom: 10px;
      margin-top: 40px;
      margin-bottom: 20px;
      background: linear-gradient(90deg, transparent 0%, #fff8e5 50%, transparent 100%);
      padding: 15px;
      border-radius: 8px;
    }

    h3 {
      color: #4a3b2a;
      font-size: 20px;
      font-weight: 600;
      margin-top: 30px;
      margin-bottom: 15px;
      border-right: 4px solid #b88d2b;
      padding-right: 15px;
    }

    h4 {
      color: #5a4a3a;
      font-size: 17px;
      font-weight: 600;
      margin-top: 25px;
      margin-bottom: 12px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 13px;
      box-shadow: 0 4px 15px rgba(184, 141, 43, 0.15);
      border-radius: 10px;
      overflow: hidden;
    }

    th {
      background: linear-gradient(135deg, #b88d2b 0%, #d4a035 100%);
      color: white;
      padding: 15px 20px;
      text-align: right;
      font-weight: 600;
      font-size: 14px;
    }

    td {
      border: 1px solid #e0c97b;
      padding: 12px 18px;
      text-align: right;
      background: white;
    }

    tr:nth-child(even) td {
      background-color: #fffdf0;
    }

    tr:hover td {
      background-color: #fff8e5;
      transition: background 0.3s;
    }

    code {
      background: linear-gradient(135deg, #f5f0e0 0%, #ebe5d5 100%);
      color: #8b6914;
      padding: 3px 8px;
      border-radius: 5px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      direction: ltr;
      display: inline-block;
      border: 1px solid #e0d5c0;
    }

    pre {
      background: linear-gradient(135deg, #2d2a26 0%, #3d3a36 100%);
      color: #f0e6d0;
      padding: 20px 25px;
      border-radius: 12px;
      overflow-x: auto;
      direction: ltr;
      text-align: left;
      font-size: 13px;
      line-height: 1.6;
      border-right: 5px solid #b88d2b;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      margin: 20px 0;
    }

    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
      border: none;
    }

    blockquote {
      border-right: 5px solid #b88d2b;
      border-left: none;
      padding: 20px 25px;
      margin: 25px 0;
      background: linear-gradient(135deg, #fffdf0 0%, #fff8e5 100%);
      border-radius: 0 12px 12px 0;
      box-shadow: 0 2px 10px rgba(184, 141, 43, 0.1);
    }

    ul, ol {
      padding-right: 30px;
      padding-left: 0;
    }

    li {
      margin: 10px 0;
      position: relative;
    }

    ul li::marker {
      color: #b88d2b;
    }

    a {
      color: #b88d2b;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.3s;
    }

    a:hover {
      color: #8b6914;
      text-decoration: underline;
    }

    hr {
      border: none;
      height: 3px;
      background: linear-gradient(90deg, transparent 0%, #e0c97b 50%, transparent 100%);
      margin: 40px 0;
    }

    strong {
      color: #4a3b2a;
      font-weight: 600;
    }

    /* Header styling */
    .header-banner {
      background: linear-gradient(135deg, #b88d2b 0%, #d4a035 50%, #b88d2b 100%);
      color: white;
      padding: 30px 40px;
      border-radius: 15px;
      margin-bottom: 40px;
      text-align: center;
      box-shadow: 0 6px 25px rgba(184, 141, 43, 0.3);
    }

    .header-banner h1 {
      color: white;
      border: none;
      margin: 0;
      padding: 0;
      background: none;
      font-size: 36px;
    }

    /* Print styles */
    @media print {
      body {
        background: white;
        padding: 20px;
        font-size: 11px;
      }
      
      h1, h2, h3 {
        page-break-after: avoid;
      }
      
      pre, table, blockquote {
        page-break-inside: avoid;
      }
      
      .header-banner {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      table th {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    @page {
      margin: 1.5cm;
      size: A4;
    }

    /* TOC styling */
    #جدول-المحتويات + ol,
    #جدول-المحتويات + ul {
      background: #fffdf0;
      padding: 25px 40px;
      border-radius: 12px;
      border: 2px solid #e0c97b;
      box-shadow: 0 4px 15px rgba(184, 141, 43, 0.1);
    }

    /* Emoji replacement */
    h1:first-of-type {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 15px;
    }

    /* Info boxes */
    p strong:first-child {
      background: linear-gradient(135deg, #b88d2b 0%, #d4a035 100%);
      color: white;
      padding: 3px 10px;
      border-radius: 5px;
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <div class="header-banner">
    <h1 style="font-size: 42px; margin-bottom: 10px;">🏡 دليل المطور الشامل</h1>
    <p style="font-size: 18px; opacity: 0.9; margin: 0;">نظام روقـان لإدارة العقارات</p>
    <p style="font-size: 14px; opacity: 0.7; margin-top: 10px;">إصدار 4.1.19 | يناير 2026</p>
  </div>
  
  ${htmlContent}
  
  <div style="text-align: center; margin-top: 60px; padding: 30px; background: linear-gradient(135deg, #fffdf0 0%, #fff8e5 100%); border-radius: 15px; border: 2px solid #e0c97b;">
    <p style="color: #b88d2b; font-size: 18px; font-weight: 600; margin: 0;">روقـان - نُـزل ورفـاهية</p>
    <p style="color: #666; font-size: 14px; margin-top: 10px;">للشاليهات والاستراحات والعقارات في منطقة القصيم</p>
    <p style="color: #999; font-size: 12px; margin-top: 15px;">© 2026 جميع الحقوق محفوظة</p>
  </div>

  <script>
    // Print button
    document.addEventListener('DOMContentLoaded', function() {
      const printBtn = document.createElement('button');
      printBtn.innerHTML = '🖨️ طباعة / حفظ PDF';
      printBtn.style.cssText = 'position: fixed; bottom: 30px; left: 30px; padding: 15px 25px; background: linear-gradient(135deg, #b88d2b 0%, #d4a035 100%); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: Cairo; font-size: 16px; font-weight: 600; box-shadow: 0 4px 15px rgba(184, 141, 43, 0.4); z-index: 9999;';
      printBtn.onclick = () => window.print();
      document.body.appendChild(printBtn);
    });
  </script>
</body>
</html>`;

writeFileSync('DEVELOPER_GUIDE.html', fullHtml);
console.log('✅ تم إنشاء DEVELOPER_GUIDE.html بنجاح!');
console.log('📄 افتح الملف في المتصفح واضغط Ctrl+P للحفظ كـ PDF');
