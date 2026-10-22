# The pretend OctoPrint printer for docker compose (see ../README.md).
FROM python:3.12-slim
RUN pip install --no-cache-dir OctoPrint==1.11.8
COPY . /pretend
EXPOSE 7140
CMD ["/pretend/start.sh", "/tmp/octoprint", "7140"]
