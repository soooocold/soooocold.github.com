---
title: Docker overlay网络获取客户端真实IP
date: 2024-04-15 09:41:32
description: 解决overlay网络下，Nginx等web服务器无法获取客户端真实IP问题
tags: docker
---
### 现象描述
使用overlay网络部署的服务（例如nginx），外部客户端访问nginx映射的业务端口，nginx日志记录不是客户端真实IP

```sehll
#创建一个nginx service
docker service create -p 99:80 nginx
#外部客户端访问
curl http://xxx.xxx.xxx.xxx:99
```
观察nginx日志，日志记录的ip并不是客户端IP，而是10.0.0.2
![图片](/images/20240426-2.png)

### 原因确认
通过查阅资料，发现宿主机到服务内部的路由，中间会经过一个ingress网络，而nginx捕获的ip正式这个ingress网络的ip
通过命令检查一下这个ingress网络可以看到
```shell
#默认不会创建，仅在创建一个带有端口映射的服务时，才会自动创建
docker network inpect ingress
```
![图片](/images/20240426-3.png)
通过下面这幅图，进一步了解ingress的作用，完成 routing mesh功能：docker swarm模式下同一个服务的端口会在所有节点暴露，通过任意节点请求都会到ingress网络，之后再转发到服务的虚拟IP。简单理解就是转发客户端请求到集群网络中。
![图片](/images/20240426-1.png)

官方文档也说明：在发布端口时，默认会ingress模式，但是还存在一种host模式，这种就是服务端口直接映射到宿主机端口。

**需要注意：使用这种模式会导致仅服务实例运行节点会发布端口，并且不可复制（replica）**

![图片](/images/20240426-4.png)
### 解决方案
服务采用host模式创建
```shell
docker service create --publish-add "mode=host,published=99,target=80" nginx
```

对于已经运行的服务，可以直接更新服务，参考：
```shell
docker service update t_openresty --publish-rm 80  --publish-add "mode=host,published=80,target=80" --publish-rm 443 --publish-add "mode=host,published=443,target=443"
```

docker-compose，参考：
```shell
version: '3'
  
services:
  nginx:
    image: nginx
    network_mode: host
    ports:
      - "99:80"
```
