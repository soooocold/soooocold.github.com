---
title: Zabbix 组件安装
date: 2024-04-12 11:36:00
description: Zabbix基于Docker安装部署
tags: Zabbix
---
**运行环境**


<div class="table-01" style="width: 50%;border: ">

| 分类             |      版本 | 
|:---------------|-----------------------------:|
| 操作系统           |                 Ubuntu 20.04 |
| docker         |                       23.0.6 |
| docker compose |                       1.25.0 | 

</div>


### 服务端安装
服务端安装需要一下三个组件：
* Postgre13
* zabbix-server
* zabbix-web
#### 文件目录准备
需要预先创建文件目录，否则容器实例会提示数据卷挂载失败
``` shell
dockerstore/
└── zabbix
    ├── zbx_pgdb
    │   └── data #数据库数据文件
    └── zbx_server
        ├── etc #zbx_server配置文件
        └── logs #zbx_server日志文件
```
#### docker compose文件准备
为了简化安装步骤，我编写了一个docker-compose文件

``` yml prod.env
DOCKERSTORE=/data/dockerstore
```

<details>
<summary> docker-compose-zabbix.yml </summary>

```  yml
version: "3.3"
networks:
 cloudtop:
  driver: overlay
  ipam:
   config:
    - subnet: 10.255.255.0/24
services:
 zbx_pgdb:
  image: docker.io/postgres:13
  ports:
   - "35400:5432"
  networks:
   cloudtop:
    aliases:
     - zbx_pgdb
  volumes:
   - "${DOCKERSTORE}/zabbix/zbx_pgdb/data:/var/lib/postgresql/data"
  deploy:
   placement:
    constraints:
     - "node.role==manager"
  environment:
   TZ : "Asia/Shanghai"
   POSTGRES_PASSWORD : "postgres_cloudtop@2021"
   PGDATA : "/var/lib/postgresql/data/pgdata"
 zbx_server:
  image: registry.cloudtop.cloud/x86_64/zabbix/server:6.4 #基于源码编译制作的镜像，需要该镜像的同学可以联系我获取
  ports:
   - "10051:10051"
  networks:
   cloudtop:
    aliases:
     - zbx_server
  volumes:
   - "${DOCKERSTORE}/zabbix/zbx_server/etc:/opt/zabbix_server/etc"
   - "${DOCKERSTORE}/zabbix/zbx_server/logs:/opt/zabbix_server/logs"
   - "/etc/localtime:/etc/localtime"
     #entrypoint: "/opt/zabbix_server/etc/start.sh"
  deploy:
   placement:
    constraints:
     - "node.role==manager"
       # environment:
    #   TZ : "Asia/Shanghai" 
    #设置时区不生效并且和/etc/localtime冲突，只挂在/etc/localtime可以生效
 zbx_web:
  image: zabbix/zabbix-web-nginx-pgsql:centos-6.4-latest
  ports:
   - "32080:8080"
  networks:
   cloudtop:
    aliases:
     - zbx_web
       #volumes:
          # - "${DOCKERSTORE}/zabbix/zbx_web/zabbix:/usr/share/zabbix" 如果需要定制一些页面功能，则需要把这个文件挂载到宿主机，持久化存储
  deploy:
   placement:
    constraints:
     - "node.role==manager"
  environment:
   DB_SERVER_HOST : "zbx_pgdb"
   DB_SERVER_PORT : "5432"
   POSTGRES_USER : "zabbix"
   POSTGRES_PASSWORD : "Cloudtop@2023"
   #ZBX_SERVER_HOST : "zbx_server" #不指定，HA集群需要从数据库读取server地址
   PHP_TZ : "Asia/Shanghai"
   ZBX_SERVER_NAME : "数据运维平台"
```
</details>

* **POSTGRES_PASSWORD 是数据库初始化时候定义的，需要保持一致**

#### 执行部署命令
``` shell
docker stack deploy -c <(docker-compose --env-file prod.env -f docker-compose-zabbix.yml config) t --with-registry-auth
```
部署完成后，查看服务器是否正常启动
![图片](/images/20240412-1.png)
### 数据库初始化
根据官方文档，需要导入初始架构和数据
#### 下载zabbix源码包，将需要的数据库文件通过数据卷上传到容器内部，执行数据导入操作
```shell
wget https://cdn.zabbix.com/zabbix/sources/stable/6.4/zabbix-6.4.13.tar.gz

tar -xzvf zabbix-6.4.13.tar.gz && cd zabbix-6.4.13/database/postgresql

cp cp data.sql  images.sql  schema.sql  /data/dockerstore/zabbix/zbx_pgdb/data/

#进入zbx_postgre容器
docker exec -it t_zbx_pgdb.1.xxx bash

cd /var/lib/postgresql/data

#创建zabbix数据库用户，输入密码并记录
su postgres -c "createuser --pwprompt zabbix"

#创建数据库
su postgres -c "createdb -O zabbix -E Unicode -T template0 zabbix"

#导入结构数据
cat schema.sql | psql -U zabbix -d zabbix
cat images.sql | psql -U zabbix -d zabbix
cat data.sql | psql -U zabbix -d zabbix
#完成退出
```


### 服务端参数配置
#### 修改配置文件zabbix_server.conf，新增以下参数：

```
DBHost=zbx_pgdb #pgdb容器主机名，也可以配置映射到宿主机ip，需要同步修改DBPort
DBPassword= #zabbix用户的密码
DBPort=5432
```

#### 更新zbx_server服务
这里我们选择删除zbx_server容器实例，守护进程会自动创建一个新实例
``` shell
docker rm -f t_zbx_server.xxx
```

### WEB服务器配置

#### 重启WEB服务
WEB服务需要的参数都已经在docker-compose-zabbix.yml文件中配置，因此在数据库初始化完成后WEB服务就可以正常访问了，为了防止奇怪的事情发生，我们手动重启WEB服务
```
docker rm -f t_zbx_web.xxx
```
#### 访问WEB服务
浏览器访问：http://server_ip:32080
默认账号：Admin
默认密码：zabbix
![图片](/images/20240412-3.png)
#### 修改默认语言
Administration→General→GUI→Default language

