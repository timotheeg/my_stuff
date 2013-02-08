#!/bin/bash

if [ $# -lt 1 ]; then
    printf 'USAGE: %s burst_number\n' $0
    exit 1
fi

BURST_NUM=$1
NUM_PROC=$(grep -c processor /proc/cpuinfo)

# verify that number of files is consistent
num_files=$(ls *.* | wc -l)
remainder=$(($num_files % $BURST_NUM))
if [ $remainder -ne 0 ]; then
    printf "Incorrect number of pictures for burst size: $num_files%%$BURST_NUM<>0\n";
    exit 2;
fi

# ok, we're cool, let's start!

mkdir -p views

CUR_VIEW=0
CUR_IDX=0

args=''

for file in $(ls *.*); do

    remainder=$(($CUR_IDX % $BURST_NUM))
    
    if [ $remainder -eq 0 ]; then
        CUR_VIEW=$(($CUR_VIEW + 1))
        args=$(printf "%s %d" "$args" $CUR_VIEW)
    fi
    
    args=$(printf "%s %s" "$args" "$file")
    
    CUR_IDX=$(($CUR_IDX + 1))
done

#xargs will distribute to CPUS :)
set -x
# echo "$args" | xargs -P $NUM_PROC -x -n $(($BURST_NUM + 1)) echo;
echo "$args" | xargs -P $NUM_PROC -x -n $(($BURST_NUM + 1)) pano_prepare_do.sh;
