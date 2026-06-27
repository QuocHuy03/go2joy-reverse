# go2joy-reverse

Công cụ desktop (Electron + React + TypeScript) cào danh sách khách sạn Go2Joy,
xuất Excel/CSV và lưu thẳng vào **Google Sheet** + upload ảnh lên **Google Drive**.

## Tính năng
- Cào theo **địa điểm, loại thuê (giờ/đêm/ngày), ngày–giờ, khoảng giá** — phân trang tự động.
- **Mỗi phòng = 1 dòng** (tên phòng, giá riêng, ảnh riêng, sđt chủ) khớp template sheet.
- **Google Sheet** (service account): ghi nối tiếp/ghi đè, tô màu loại thuê, theo batch.
- **Google Drive** (OAuth): cây thư mục `Khách sạn / (Hình Chính + folder từng phòng)`,
  bỏ qua ảnh đã có, retry khi rate limit.
- Lưu cấu hình vào **SQLite** (tự nạp lại), tự động lưu sau khi quét.

## Chạy
```bash
npm install
npm run dev      # phát triển
npm start        # build + chạy
npm run dist     # đóng gói installer Windows (release/)
```

## Cấu hình Google
- **Sheet**: tạo service account → bật Google Sheets API → share Sheet (Editor) cho email service account → nạp file JSON.
- **Drive**: tạo OAuth Client (Desktop) → bật Google Drive API → đăng nhập trong app.

> Không commit file JSON service account / OAuth secret (đã đưa vào `.gitignore`).
