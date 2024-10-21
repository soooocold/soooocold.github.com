---
title: Postgre高可用配置
date: 2024-10-21 11:40:37
tags: Postgre
---

**环境节点详情**

<div class="table-01" style="width: 50%;border: ">

| 节点分类 | 主机名 | 节点环境       |
|----------|--------|----------------|
| pgNode1     | pgdb1  | Docker23.0.6 PostgreSQL13 |
| pgNode2     | pgdb2  | Docker23.0.6 PostgreSQL13 |
| pgpoolNode1     | pgpool-1  | PostgreSQL13 PGPOOL2-4.5.4 |
| pgpoolNode2     | pgpool-2  | PostgreSQL13 pgpool2-4.5.4 |
| pgpoolNode3     | pgpool-3  | PostgreSQL13 pgpool2-4.5.4 |
</div>

**故障漂移思想**
1. 主备搭建完毕后，使用pgpool实现读写分离
2. pgpool至少三个节点，并且监听数据库状态
3. 当主数据库宕机，触发failover，执行备库提权命令，使得备库成为新的主库，成为主库之后，需要删掉数据目录中的postgresql.auto.conf文件
4. 原有主库恢复之后，需要手动处理，成为新的备库加入集群

### 数据库主节点安装
<details>
<summary> postgre_primary_create.sh </summary>
``` shell 
#!/bin/bash
docker create --name postgre_primary \
              -p 0.0.0.0:5400:5400 \
              -e TZ=Asia/Shanghai \
              --restart always \
              -v /data/dockerstore/postgre/data:/pgdata/data \
              --dns 8.8.8.8 \
              --hostname postgre \
              --ulimit nofile=102400:102400 \
              --ulimit nproc=102400 \
              --sysctl net.core.somaxconn=65535 \
              --entrypoint /pgdata/data/pg_start.sh \
              registry.cloudtop.cloud/x86_64/postgre:13.4.1
```
<summary> pg_start.sh  </summary>
```shell
#!/bin/bash
#chown -R postgres:postgres /pgdata
#sleep 100000
chmod -R 700 /pgdata/data
su postgres -c "source /etc/profile && postgres"
```
</details>

#### 主库初始化
执行容器创建脚本，进入容器使用psql登录数据库，并执行以下操作
```shell
#创建复制账号
CREATE USER replica replication encrypted password  'replica';

#修改pg_hba.conf,添加以下内容
host   replication    replica    192.168.0.165/32     trust

#修改postgresql.conf
wal_level = replica

#重启数据库
```

### 数据库备用节点安装
<details>
<summary> postgre_standby_create.sh </summary>
``` shell 
#!/bin/bash
docker create --name postgre_standby \
              -p 0.0.0.0:5400:5400 \
              -e TZ=Asia/Shanghai \
              --restart always \
              -v /data/dockerstore/postgre/data:/pgdata/data \
              --dns 8.8.8.8 \
              --hostname postgre \
              --ulimit nofile=102400:102400 \
              --ulimit nproc=102400 \
              --sysctl net.core.somaxconn=65535 \
              --entrypoint /pgdata/data/pg_start.sh \
              registry.cloudtop.cloud/x86_64/postgre:13.4.1
```
<summary> pg_start.sh  </summary>
```shell
#!/bin/bash
#sleep 100000
chmod -R 700 /pgdata/data
su postgres -c "source /etc/profile && postgres"
```
</details>

#### 备库初始化
<span style="color:red;">备库初始化要求数据库是关闭状态，因此容器启动时需要手动修改entrypoint命令，使用bash进入容器进行初始化操作，而不是直接启动数据库进程</span>

``` shell
#复制主库基础数据
pg_basebackup -F p -P -R -D /data/pgdata  -h xx.xx.xx.xx -p 5432 -U replica -W  (主库ip)

#修改postgresql.conf
hot_standby = on ＃ 说明这台机器不仅仅是用于数据归档，也用于数据查询
max_standby_streaming_delay = 30s # 数据流备份的最大延迟时间
wal_receiver_status_interval = 10s # 多久向主报告一次从的状态
hot_standby_feedback = on # 如果有错误的数据复制，是否向主进行反馈

#启动数据库
```
### 主备检查
#### 节点状态检查
```shell
#psql连接主库，执行以下操作
select pg_is_in_recovery();
```
备库 t；主库 f
#### 流复制功能检查
主库创建表结构、插入数据，观察备库是否正常同步；
确认备库无数据写入权限

### pgpoolⅡ安装（源码编译）
#### 环境安装
由于pgpool在编译安装依赖postgre相关环境，因此需要先安装postgre数据库（只需要安装，不需要启动）以及必要的工具包。
```shell
sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update
#安装postgre的版本和数据库节点的版本一致
sudo apt-get -y install postgresql-13

sudo apt install build-essential
sudo apt install libpq-dev

apt install arping #解决VIP切换节点，交换机arp表项更新不及时问题
```
#### pgpoolⅡ编译
```shell
#源码下载，本次使用版本：4.5.4
wget https://www.pgpool.net/mediawiki/images/pgpool-II-4.5.4.tar.gz 
tar -xzvf pgpool-II-4.5.4.tar.gz
cd pgpool-II-4.5.4
./configure  --prefix=/opt/pgpool2-4.5.1  --with-pgsql-includedir=/usr/include/postgresql
make && make install 
ln -s /opt/pgpool2-4.5.4 /opt/pgpool2
```
#### 环境优化（可选）
```
/etc/sysctl.conf
net.core.somaxconn = 65500
```

### pgpoolⅡ配置
#### pgpoolⅡ运行环境初始化
```
#以下操作三台节点同步进行
mkdir /opt/pgpool2/prod && cd /opt/pgpool2/prod 
#执行以下命令会在当前文件夹下生成pgpoolⅡ相关配置
../../bin/ ../../bin/pgpool_setup

#生成pcp密码,写入pcp.conf 
pg_md5   youer_password
#生成pool_md5密码,写入pool_passwd 
../../bin/pg_md5 -m -f pgpool.conf   -p -u pgdb_user

#修改pool_hba.conf
echo "host    all         all         0.0.0.0/0             md5" >> etc/pool_hba.conf

#将节点对应ip写入/etc/hosts文件
xx.xx.xx.230 pgdb1
xx.xx.xx.231 pgdb2
xx.xx.xx.232 pgpool-1
xx.xx.xx.233 pgpool-2
xx.xx.xx.234 pgpool-3
```

每个pgpool节点目录prod/etc中创建以下文件pgpool_node_id，写入不同id

<div class="table-01" style="width: 50%;border: ">

| 节点 | pgpool_node_id |
|----------|--------|
| pgpoolNode1     | 0  |
| pgpoolNode2     | 1  |
| pgpoolNode3     | 2  |
</div>

#### pgpool.conf配置
配置文件包含大量参数配置，主要参数如下，可直接在文件末尾添加
<span style="color:red;">注意：配置文件包含本机网卡名的配置，需要根据实际情况修改</span>
<details>
<summary> pgpool.conf  </summary>
```shell
backend_clustering_mode = streaming_replication
enable_pool_hba = on
listen_addresses = '*'
sr_check_user = 'pgdb_user' #流复制状态检查
sr_check_password = 'pgdb_password' 
health_check_period0 = 10
health_check_timeout0 = 20
health_check_user0 = 'pgdb_user' #健康状态检查
health_check_password0 = 'pgdb_password'
health_check_database0 = 'postgres'
health_check_max_retries0 = 3
health_check_retry_delay0 = 1
connect_timeout0 = 1000
health_check_period1 = 10
health_check_timeout1 = 20
health_check_user1 = 'pgdb_user'
health_check_password1 = 'usr@pgdb_password'
health_check_database1 = 'postgres'
health_check_max_retries1 = 3
health_check_retry_delay1 = 1
connect_timeout1 = 1000
memqcache_oiddir = '/opt/pgpool2/prod/log/pgpool/oiddir'
log_per_node_statement = on
failover_command = '/opt/pgpool2/prod/etc/failover.sh %h %H'
unix_socket_directories = '/tmp'
pcp_socket_dir = '/tmp'
logging_collector = off
log_line_prefix = '%m: %a pid %p: '
port = 5400
pcp_port = 11001
pid_file_name = '/opt/pgpool2/prod/run/pgpool.pid'
logdir = '/opt/pgpool2/prod/log'
backend_hostname0 = 'pgdb1' #后端数据库主节点
backend_port0 = 5400
backend_weight0 = 1
backend_hostname1 = 'pgdb2' #后端数据库备用节点
backend_port1 = 5400
backend_weight1 = 1

use_watchdog = on
trusted_servers = 'pgpool-1,pgpool-2,pgpool-3'
hostname0 = 'pgpool-1'
wd_port0 = 9000
pgpool_port0 = 5400

hostname1 = 'pgpool-2'
wd_port1 = 9000
pgpool_port1 = 5400

hostname2 = 'pgpool-3'
wd_port2 = 9000
pgpool_port2 = 5400

wd_priority = 3 #wd_priority值较高的节点作为Leader节点
wd_authkey = 'CloudtopKey'
delegate_ip = 'xx.xx.xx.235'
if_up_cmd = '/usr/bin/sudo /sbin/ip addr add $_IP_$/24 dev ens18 label ens18:0'
if_down_cmd = '/usr/bin/sudo /sbin/ip addr del $_IP_$/24 dev ens18'
arping_cmd = '/usr/bin/sudo /usr/sbin/arping -U $_IP_$ -w 1 -I ens18:0'
clear_memqcache_on_escalation = on

wd_monitoring_interfaces_list = 'ens18'
wd_lifecheck_method = 'heartbeat'
wd_interval = 1
heartbeat_hostname0 = 'pgpool-1'
heartbeat_port0 = 9694
heartbeat_device0 = 'ens18'

heartbeat_hostname1 = 'pgpool-2'
heartbeat_port1 = 9694
heartbeat_device1 = 'ens18'

heartbeat_hostname2 = 'pgpool-3'
heartbeat_port2 = 9694
heartbeat_device2 = 'ens18'
```
</details>

#### 故障转移脚本
pgpoolⅡ环境初始化时会生成一个故障转移脚本，经过测试发现该脚本存在兼容性问题，主要原因来自shell脚本传递变量参数，当变量为null，参数位置变化导致脚本执行异常，可直接使用以下脚本
<details>
<summary> failover.sh  </summary>
```
failed_node_hostname=$1
new_main_hostname=$2
mydir=/opt/pgpool2/prod
log=$mydir/log/failover.log
pgpassword="pgdb_password"

date >> $log
echo "failover script started for node: $failed_node_hostname" >> $log
echo "new node: $new_main_hostname" >> $log
export PGPASSWORD=${pgpassword}
psql -h $new_main_hostname -U pgdb_user -p 5400  -d postgres -c "SELECT pg_promote();"
if [ $? -eq 0 ]; then
    echo "Standby database promoted successfully." >> $log
else
    echo "Failed to promote standby database." >> $log
    export -n PGPASSWORD
    exit 1
fi
export -n PGPASSWORD
date >> $log
echo "failover script ended" >> $log
```
</details>

### pgpoolⅡ管理
#### pgpoolⅡ启停管理
环境初始化后，在prod下会生成两个可执行脚本：startall、shutdownall，需要手动注释和数据库启停相关命令，仅保留pgpoolⅡ程序的启停命令

### pcp命令行工具 
pgpool-II 提供了一个命令行工具 pcp（Pgpool Control Protocol），用于管理和监控 pgpool-II 集群，命令在/opt/pgpool2/bin，使用该工具需要对pcp.conf进行密码生成，以及在pgpool.conf中定义pcp的端口：pcp_port
使用参考示例：
```
#获取集群数据库节点信息
pcp_watchdog_info  -W -p 11001
```