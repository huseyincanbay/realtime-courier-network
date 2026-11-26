FROM python:3.13-slim
WORKDIR /sim
COPY pyproject.toml ./
COPY rcnsim ./rcnsim
RUN pip install --no-cache-dir .
COPY scenarios ./scenarios
ENTRYPOINT ["python", "-m", "rcnsim"]
