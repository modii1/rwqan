import { mdToPdf } from 'md-to-pdf';
import { readFileSync, writeFileSync } from 'fs';

const cssStyles = `
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap');

* {
  direction: rtl;
  text-align: right;
}

body {
  font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
  font-size: 12px;
  line-height: 1.8;
  color: #333;
  background: #fff;
  padding: 20px 40px;
}

h1 {
  color: #b88d2b;
  font-size: 28px;
  font-weight: 700;
  border-bottom: 3px solid #b88d2b;
  padding-bottom: 10px;
  margin-top: 40px;
}

h2 {
  color: #8b6914;
  font-size: 22px;
  font-weight: 600;
  border-bottom: 2px solid #e0c97b;
  padding-bottom: 8px;
  margin-top: 30px;
}

h3 {
  color: #4a3b2a;
  font-size: 18px;
  font-weight: 600;
  margin-top: 25px;
}

h4 {
  color: #5a4a3a;
  font-size: 16px;
  font-weight: 600;
  margin-top: 20px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 15px 0;
  font-size: 11px;
}

th {
  background: linear-gradient(135deg, #b88d2b 0%, #d4a035 100%);
  color: white;
  padding: 12px 15px;
  text-align: right;
  font-weight: 600;
}

td {
  border: 1px solid #e0c97b;
  padding: 10px 15px;
  text-align: right;
}

tr:nth-child(even) {
  background-color: #fffdf0;
}

tr:hover {
  background-color: #fff8e5;
}

code {
  background: #f5f0e0;
  color: #8b6914;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  direction: ltr;
  text-align: left;
}

pre {
  background: linear-gradient(135deg, #2d2a26 0%, #3d3a36 100%);
  color: #f0e6d0;
  padding: 15px 20px;
  border-radius: 8px;
  overflow-x: auto;
  direction: ltr;
  text-align: left;
  font-size: 11px;
  line-height: 1.5;
  border-left: 4px solid #b88d2b;
}

pre code {
  background: transparent;
  color: inherit;
  padding: 0;
}

blockquote {
  border-right: 4px solid #b88d2b;
  border-left: none;
  padding-right: 20px;
  margin: 20px 0;
  background: #fffdf0;
  padding: 15px 20px;
  border-radius: 0 8px 8px 0;
}

ul, ol {
  padding-right: 25px;
  padding-left: 0;
}

li {
  margin: 8px 0;
}

a {
  color: #b88d2b;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

hr {
  border: none;
  border-top: 2px solid #e0c97b;
  margin: 30px 0;
}

strong {
  color: #4a3b2a;
  font-weight: 600;
}

.page-break {
  page-break-after: always;
}

@page {
  margin: 2cm;
  size: A4;
}

@media print {
  h1, h2, h3 {
    page-break-after: avoid;
  }
  pre, table {
    page-break-inside: avoid;
  }
}
`;

async function generatePDF() {
  try {
    console.log('🔄 جاري إنشاء ملف PDF...');
    
    const pdf = await mdToPdf(
      { path: 'docs/guides/developer-guide.md' },
      {
        css: cssStyles,
        pdf_options: {
          format: 'A4',
          margin: {
            top: '2cm',
            bottom: '2cm',
            left: '2cm',
            right: '2cm'
          },
          printBackground: true
        },
        launch_options: {
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      }
    );
    
    if (pdf) {
      writeFileSync('docs/guides/developer-guide.pdf', pdf.content);
      console.log('✅ تم إنشاء docs/guides/developer-guide.pdf بنجاح!');
      console.log('📄 حجم الملف:', Math.round(pdf.content.length / 1024), 'KB');
    }
  } catch (error) {
    console.error('❌ خطأ:', error.message);
  }
}

generatePDF();
