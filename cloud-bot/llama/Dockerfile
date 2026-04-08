FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    git cmake build-essential curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone https://github.com/ggerganov/llama.cpp.git
WORKDIR /opt/llama.cpp

RUN cmake -B build -DGGML_NATIVE=ON -DGGML_OPENMP=ON \
 && cmake --build build -j 2

EXPOSE 8080
ENTRYPOINT ["/opt/llama.cpp/build/bin/llama-server"]
