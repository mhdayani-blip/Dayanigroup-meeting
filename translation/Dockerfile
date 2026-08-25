FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/huggingface

COPY translation/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY translation/app.py ./app.py

EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
