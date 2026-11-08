FROM violin321/bm-bt-proxy@sha256:d59c9d5a6852dbc9d50e11c102c80fa985d6686fc3b670cc9f2322b22748ee9e
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="db_online BM-BT adapter" \
      org.opencontainers.image.version="0.3.1" \
      org.opencontainers.image.revision=$VCS_REF
WORKDIR /srv
COPY main.py /srv/adapter/main.py
ENV PYTHONDONTWRITEBYTECODE=1
USER 65534:65534
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9091/health',timeout=3)" || exit 1
CMD ["uvicorn", "adapter.main:app", "--host", "0.0.0.0", "--port", "9091", "--no-access-log"]
