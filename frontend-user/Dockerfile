# 使用官方nginx:alpine镜像，支持多架构（ARM64/AMD64）
FROM nginx:alpine

# 复制静态文件到nginx目录
COPY . /usr/share/nginx/html/

# 删除Dockerfile避免暴露
RUN rm -f /usr/share/nginx/html/Dockerfile

# 配置nginx
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
