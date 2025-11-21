import { useState } from "react";

export default function TestImages() {
  const [input, setInput] = useState("");
  const [imageId, setImageId] = useState("");

  // استخراج ID من رابط Google Drive تلقائيًا
  const extractId = (url) => {
    const match = url.match(/\/d\/(.*?)\//);
    return match ? match[1] : url;
  };

  const handleTest = () => {
    const id = extractId(input.trim());
    setImageId(id);
  };

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, marginBottom: 10 }}>
        🔍 اختبار عرض صور Google Drive عبر البروكسي
      </h1>

      {/* إدخال رابط أو ID */}
      <input
        type="text"
        placeholder="ألصق رابط Google Drive أو الـ ID فقط"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{
          width: "100%",
          padding: "10px",
          fontSize: 16,
          borderRadius: 8,
          border: "1px solid #ccc",
        }}
      />

      <button
        onClick={handleTest}
        style={{
          marginTop: 12,
          padding: "10px 20px",
          fontSize: 16,
          background: "#b88d2b",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        عرض الصورة
      </button>

      {/* عرض الصورة */}
      {imageId && (
        <div style={{ marginTop: 20 }}>
          <p style={{ marginBottom: 5, fontWeight: "bold" }}>النتيجة:</p>

          <img
            src={`/proxy/drive/${imageId}`}
            alt="Test"
            style={{
              width: "100%",
              maxWidth: 400,
              borderRadius: 10,
              border: "2px solid #000",
            }}
          />

          <p style={{ marginTop: 10, fontSize: 14 }}>
            الصورة تُعرض من:  
            <code style={{ background: "#eee", padding: "4px 8px", borderRadius: 6 }}>
              /proxy/drive/{imageId}
            </code>
          </p>
        </div>
      )}
    </div>
  );
}
