#!/usr/bin/env bash
set -euo pipefail

readonly installer_header='# 妙妙屋 Docker 安装配置 v1'
readonly repository='https://github.com/fanzheng833-code/miaomiaowu.git'
readonly default_ref=install

fail() {
    printf '妙妙屋安装失败：%s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<EOF
妙妙屋 Docker 一键安装
用法：bash docker-install.sh [--dir 路径] [--port 端口] [--ref Git引用] [--public | --local]

首次安装默认目录为 ~/miaomiaowu，端口为 8080，来源为 $default_ref，仅本机可访问。
--public  允许从服务器的其他 IPv4 地址访问
--local   恢复仅本机访问
--ref     GitHub 分支、标签或完整提交号
重复运行时沿用同一目录里的配置；指定选项可修改脚本生成的配置。
EOF
}

valid_port() {
    [[ $1 =~ ^[1-9][0-9]{0,4}$ ]] && (( $1 <= 65535 ))
}

valid_ref() {
    [[ $1 =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && $1 != *..* ]]
}

render_compose() {
    local ref=$1 port=$2 bind=$3
    cat <<EOF
$installer_header
# install-options $project $ref $port $bind
name: $project
services:
  miaomiaowu:
    build:
      context: "$repository#$ref"
    restart: unless-stopped
    ports:
      - "$bind:$port:8080"
    volumes:
      - ./data:/app/data
      - ./subscribes:/app/subscribes
      - ./rule_templates:/app/rule_templates
EOF
}

install_dir=${HOME:+$HOME/miaomiaowu}
requested_port=
requested_ref=
requested_bind=
while (( $# )); do
    case $1 in
        --dir|--port|--ref)
            [[ -n ${2:-} && $2 != --* ]] || fail "$1 缺少参数。"
            case $1 in
                --dir) install_dir=$2 ;;
                --port) requested_port=$2 ;;
                --ref) requested_ref=$2 ;;
            esac
            shift 2
            ;;
        --public) requested_bind=0.0.0.0; shift ;;
        --local) requested_bind=127.0.0.1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) fail "未知选项 $1。使用 --help 查看用法。" ;;
    esac
done

[[ -n $install_dir ]] || fail '请使用 --dir 指定安装目录。'
[[ -z $requested_port ]] || valid_port "$requested_port" || fail '端口必须是 1 到 65535 之间的整数。'
[[ -z $requested_ref ]] || valid_ref "$requested_ref" || fail '请指定有效的 Git 分支、标签或完整提交号。'
docker compose version >/dev/null 2>&1 || fail '请先安装 Docker 和 Docker Compose v2。'
docker info >/dev/null 2>&1 || fail '无法连接 Docker，请确认服务已启动且当前用户有访问权限。'

mkdir -p -- "$install_dir"
install_dir=$(cd -- "$install_dir" && pwd -P)
compose_file=$install_dir/compose.yaml
lock_dir=$install_dir/.miaomiaowu-install.lock
temp_file=
mkdir -- "$lock_dir" 2>/dev/null || fail "无法锁定安装目录，请检查写入权限或等待同一目录中的安装结束。锁目录：$lock_dir"
cleanup() {
    if [[ -n $temp_file ]]; then rm -f -- "$temp_file"; fi
    rmdir -- "$lock_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ ! -L $compose_file ]] || fail "安装目录里已有 Compose 链接，请选择其他目录：$compose_file"
project=miaomiaowu-$RANDOM-$RANDOM
saved_ref=$default_ref
saved_port=8080
saved_bind=127.0.0.1
write_config=1
if [[ -e $compose_file ]]; then
    [[ -f $compose_file ]] || fail "安装目录里已有同名路径：$compose_file"
    if ! {
        IFS= read -r header &&
        IFS=' ' read -r comment kind project saved_ref saved_port saved_bind trailing
    } < "$compose_file" ||
        [[ $header != "$installer_header" || $comment != '#' || $kind != install-options || -n $trailing ]] ||
        [[ ! $project =~ ^miaomiaowu-[0-9]+-[0-9]+$ ]] ||
        ! valid_ref "$saved_ref" || ! valid_port "$saved_port" ||
        [[ $saved_bind != 127.0.0.1 && $saved_bind != 0.0.0.0 ]]; then
        fail "安装目录里已有其他 Compose 配置，请选择其原有部署方式或更换目录：$compose_file"
    fi
    write_config=0
else
    for existing in compose.yml docker-compose.yaml docker-compose.yml; do
        [[ ! -e $install_dir/$existing && ! -L $install_dir/$existing ]] ||
            fail "安装目录里已有 Compose 配置，请选择其他目录：$install_dir/$existing"
    done
fi

ref=${requested_ref:-$saved_ref}
port=${requested_port:-$saved_port}
bind=${requested_bind:-$saved_bind}
if [[ $ref != "$saved_ref" || $port != "$saved_port" || $bind != "$saved_bind" ]]; then
    if (( ! write_config )) && [[ $(render_compose "$saved_ref" "$saved_port" "$saved_bind") != "$(< "$compose_file")" ]]; then
        fail "Compose 配置已手动修改，请在该文件中调整端口、绑定地址或来源：$compose_file"
    fi
    write_config=1
fi

mkdir -p -- "$install_dir"/{data,subscribes,rule_templates}
if (( write_config )); then
    temp_file=$(mktemp "$install_dir/.compose.XXXXXX")
    render_compose "$ref" "$port" "$bind" > "$temp_file"
    mv -- "$temp_file" "$compose_file"
    temp_file=
fi

compose=(docker compose --project-directory "$install_dir" -f "$compose_file" --project-name "$project")
"${compose[@]}" config --quiet || fail "Compose 配置校验失败：$compose_file"
printf '正在从 GitHub 构建妙妙屋并启动面板（%s）…\n' "$ref"
if ! "${compose[@]}" up --build --wait --wait-timeout 120; then
    printf '查看日志：'
    printf '%q ' "${compose[@]}" logs miaomiaowu
    printf '\n'
    fail '构建或启动失败。配置和数据已保留，处理报错后可运行同一条命令重试。'
fi

address=$("${compose[@]}" port miaomiaowu 8080 2>/dev/null) || address=$bind:$port
printf '妙妙屋已启动。访问地址：http://%s\n安装目录：%s\n' "${address/#0.0.0.0:/127.0.0.1:}" "$install_dir"
if [[ $address == 0.0.0.0:* ]]; then
    printf '其他设备可以通过服务器 IP 和端口 %s 访问。\n' "${address##*:}"
fi
printf '首次访问时请创建管理员账号。\n'
