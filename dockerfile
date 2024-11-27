# Sử dụng Node.js base image
FROM node:18

# Tạo thư mục ứng dụng trong container
WORKDIR /app

# Sao chép file package.json và package-lock.json (nếu có)
COPY package*.json ./

# Cài đặt các dependencies
RUN npm install

# Sao chép toàn bộ mã nguồn vào container
COPY . .

# Expose cổng mà ứng dụng Node.js đang chạy (ví dụ: 3000)
EXPOSE 3000

# Lệnh để chạy ứng dụng
CMD ["npm", "start"]
