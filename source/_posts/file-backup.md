---
title: 基于Linux硬链接的增量备份脚本
date: 2024-05-14 16:41:51
tags:
---
### 原理简述
#### 硬链接
在Linux中，每一个文件必定有一个inode标识（包含文件的元数据并指向包含文件内容的数据块），
其实每一个文件都是inode的硬链接，在文件创建时，默认连接到inode。

![图片](/images/20240514-1.png)
当我们将多个文件连接到同一个inode时，这些文件会共享真实的数据块，而不会增加存储消耗。
![图片](/images/20240514-2.png)

上图我们生成了一个10M大小的文件 myfile ，通过硬链接生成 myfile_ln，可以看到两个文件指向了相同的inode，并且没有消耗额外的存储空间
#### rsync
rsync 可按照硬链接的方式进行增量备份
具体这里不演示了，好奇的小伙伴可以自行上手实验
```shell
rsync --link-dest basefile ...
```
### 备份脚本实例
基于rsync的文件备份脚本
<details>
<summary> file_backup.sh </summary>

```shell
#!/bin/bash
# 注意
# 该脚本需要在备份服务器上运行，通过SSH远程备份文件。
# 请先完成备份服务器到源服务器免密SSH登录操作。
#任何错误立即退出
set -o errexit
#使用未初始化的变量立即退出
set -o nounset
#管道命令中子命令失败立即退出
set -o pipe fail

#数据源主机信息
HOST=127.0.0.1
PORT=22
USER=cloudtop

#备份文件
#基础文件多久更新(天)
BASE_UPDATE_DAYS=15
#备份文件多久删除（天）
BACKUP_DELETE_DAYS=15



#文件MAP[源地址]=备份地址
declare -A TARGET_MAP
TARGET_MAP["/home/cloudtop/test"]="/home/cloudtop/rsync-shell/test_3"
TARGET_MAP["/home/cloudtop/shell"]="/home/cloudtop/rsync-shell/shell_3"


#预处理，如果备份路径不存在则创建
for dest_path in "${TARGET_MAP[@]}";
do
	[ -d ${dest_path} ] || mkdir -p ${dest_path}
done


#记录日志
LOG_FILE="/home/cloudtop/rsync-shell/logfile.log"
log_message() {
    local message="$1"
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    echo "[$timestamp] $message" >> "$LOG_FILE"
}

#拉取基础文件
pull_base_files() {
	#参数1：源目录
	#参数2：目标目录
	log_message "开始拉取基础文件：${1}"
	rsync -ar --delete -e "ssh -p ${PORT}"  ${USER}@${HOST}:${1} ${2}
	log_message "完成拉取基础文件：${1} -> ${2}"
}
#拉取备份文件
pull_backup_files() {
        #参数1：源目录
        #参数2：目标目录
	#参数3：基础文件目录
        log_message "开始拉取备份文件：${1}"
        rsync -ar --delete --link-dest ${3} -e "ssh -p ${PORT}"   ${USER}@${HOST}:${1} ${2}
        log_message "完成拉取备份文件：${1} -> ${2}"
}


#检查基础文件是否存在
check_base_files() {
	#遍历目标路径，如果路径不存在，则拉取新基础文件
	for src_path in "${!TARGET_MAP[@]}";
	do
		if [ ! -d "${TARGET_MAP[${src_path}]}/basefile" ]; then
			#拉取新文件
			log_message "未找到基础文件：${TARGET_MAP[${src_path}]}，准备拉取"
			pull_base_files "${src_path}" "${TARGET_MAP[${src_path}]}/basefile"
		fi

	done
}

#更新基础文件
update_base_files() {

	for src_path in "${!TARGET_MAP[@]}";
	do
		#获取基础文件目录修改的时间戳
		base_dir_mod_time=$(stat -c %Y "${TARGET_MAP[${src_path}]}/basefile")
		#获取基础文件过期的时间戳
		base_expire_time=$((base_dir_mod_time + BASE_UPDATE_DAYS * 24 * 60 * 60))
		#base_expire_time=$((base_dir_mod_time + 60))
		#获取当前时间戳
		current_time=$(date +%s)
	
		#如果当前时间大于基础文件过期时间，则删除过期文件，拉取新基础文件
		if [ "$current_time" -ge "$base_expire_time" ]; then
			log_message "基础文件过期：${TARGET_MAP[${src_path}]}/basefile，准备拉取"
			pull_base_files "${src_path}" "${TARGET_MAP[${src_path}]}/basefile"
		fi
	done
}


#每天增量备份
backup_daily() {
	today=$(date +"%Y-%m-%d")
	for src_path in "${!TARGET_MAP[@]}";
	do
		#删除过期备份文件
		find "${TARGET_MAP[${src_path}]}/backupfile" -mindepth 1 -maxdepth 1 -cmin +${BACKUP_DELETE_DAYS} -exec rm -rf {} +	
		#本次备份文件路径
		backup_path="${TARGET_MAP[${src_path}]}/backupfile/${today}"
		#备份文件依赖的基础文件
		basefile_path="${TARGET_MAP[${src_path}]}/basefile"
		#如果备份目录存在，则创建备用备份目录
		if [ -d ${backup_path} ]; then
			count=1
			while true; do
				backup_path_new="${backup_path}"_"${count}"
				if [ ! -d ${backup_path_new} ]; then
					log_message "备份目录已存在，创建备用目录：${backup_path_new}"
					mkdir -p ${backup_path_new}
					pull_backup_files ${src_path} ${backup_path_new} ${basefile_path}
					break
				fi
				# 如果备用目录存在，则尝试下一个备用目录
				((count++))
			done
			
		else
			mkdir -p ${backup_path}
			log_message "需要备份的文件：${src_path}，准备拉取"
			pull_backup_files ${src_path} ${backup_path} ${basefile_path} 
		fi

	done
}
#脚本主入口
main() {

	update_base_files
	check_base_files
	update_base_files
	backup_daily
}
main
```

</details>