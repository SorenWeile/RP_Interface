# Base image: RunPod ComfyUI (adjust tag as needed)
FROM runpod/comfyui:latest

# Node.js for building React
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*

# Build frontend
COPY frontend/ /app/frontend/
WORKDIR /app/frontend
RUN npm install && npm run build

# Backend
COPY backend/ /app/backend/
RUN pip install -r /app/backend/requirements.txt

# Copy React dist into FastAPI static dir
RUN cp -r /app/frontend/dist /app/backend/static

WORKDIR /app
EXPOSE 8000

CMD ["/app/start.sh"]
