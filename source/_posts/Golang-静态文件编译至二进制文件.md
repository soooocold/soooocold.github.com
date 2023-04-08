---
title: Golang 静态文件编译至二进制文件
date: 2023-04-08 16:07:37
tags: Golang
---
```go
#目录结构
│  main.go
└─static
        1.png
        wechat.html
```
```go
//go:embed static/*
var fs embed.FS
func main() {
r := gin.Default()
	r.Any("/static/*filepath", func(c *gin.Context) {
		staticServer := http.FileServer(http.FS(fs))
		staticServer.ServeHTTP(c.Writer, c.Request)

	})
	r.GET("/", func(c *gin.Context) {
		//c.HTML(200, "wechat.html", nil)
		b, _ := fs.ReadFile("static/wechat.html")
		c.Data(200, "", b)

	})
}

```
