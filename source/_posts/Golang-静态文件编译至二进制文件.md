---
title: Golang 静态文件编译至二进制文件
date: 2023-04-08 16:07:37
tags: Golang
---
```go
//go:embed static/*
var fs embed.FS
func main() {
r := gin.Default()
	r.Any("/static/*filepath", func(c *gin.Context) {
		staticServer := http.FileServer(http.FS(fs))
		staticServer.ServeHTTP(c.Writer, c.Request)

	})
}

```
