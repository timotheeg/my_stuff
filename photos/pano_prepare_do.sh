#!/bin/bash

set -x

CUR_VIEW=$1
shift

args=("$@")

exif_ref_idx=$(( $# / 2 ))
exif_ref_file=${args[$exif_ref_idx]}

# process each file first
for file in "$@"; do
    exiftool -m -overwrite_original_in_place -ifd1:all= "$file";
done

# prepare HDR view
if [ $# -gt 1 ]; then
    align_image_stack -g 6 -c 12 -e -a ALIGN_${CUR_VIEW}_ $@
else
    convert $@ ALIGN_${CUR_VIEW}_0000.tif
fi

# manually recopy all the exif tags (required for hdr blending and exposure detection)
# and let's also compute the exposure list, assuming all shots are 1 ev apart
idx=0
evs=""
curev=-$(($# / 2))
for file in "$@"; do 
    # exiftool -m -overwrite_original_in_place -tagsfromfile "$file" -all:all $(printf "ALIGN_${CUR_VIEW}_%04d.tif" "$idx");
    if [ -n "$evs" ];
    then
        evs=$evs,$curev;
    else
        evs=$curev;
    fi

    idx=$(($idx + 1));
    curev=$(($curev + 1));
done

enfuse_file="views/view_${CUR_VIEW}_enfuse.tif"
hdr_input="views/tmp_${CUR_VIEW}.hdr"
hdr_fattal_file="views/view_${CUR_VIEW}_hdr_tonemapped_fattal.tif"
hdr_mantiuk_file="views/view_${CUR_VIEW}_hdr_tonemapped_mantiuk.tif"
tmp_file_1="/tmp/tmp_${CUR_VIEW}_1.tif"
tmp_file_2="/tmp/tmp_${CUR_VIEW}_2.tif"
tmp_file_3="/tmp/tmp_${CUR_VIEW}_3.tif"
final_file="views/view_${CUR_VIEW}_final.tif"

enfuse -d 8 -o "$tmp_file_1" ALIGN_${CUR_VIEW}_*
convert "$tmp_file_1" -unsharp 0.9x1.0+1.1+0.02 -level 5% "$enfuse_file"

# pfsinme ALIGN_${CUR_VIEW}_* | pfshdrcalibrate | pfsoutrgbe "$hdr_input"
# pfsin "$hdr_input" | pfstmo_fattal02 -a 0.1 -b 0.85 -s 0.65 -n 0.005 -v | pfsoutimgmagick "$hdr_fattal_file"
# pfsin "$hdr_input" | pfstmo_mantiuk06 -v | pfsgamma 2.0 | pfsoutimgmagick "$hdr_mantiuk_file"

luminance-hdr-cli \
    -c weight=triangular:response_curve=linear:model=debevec \
    -g 1 -t fattal \
    -p new=true:alpha=1:beta=0.9:color=0.8:noise=0 \
    -e $evs \
    -o "$hdr_fattal_file" \
    ALIGN_${CUR_VIEW}_*

luminance-hdr-cli \
    -c weight=triangular:response_curve=linear:model=debevec \
    -g 1 -t mantiuk06 \
    -p contrast=0.2:saturation=0.9:detail=1:equalization=false \
    -e $evs \
    -o "$hdr_mantiuk_file" \
    ALIGN_${CUR_VIEW}_*

convert "$enfuse_file" "$hdr_fattal_file" -compose Mathematics -define compose:args='0,1,1,-0.5' -composite "$tmp_file_1"
convert "$enfuse_file" "$hdr_mantiuk_file" -compose Mathematics -define compose:args='0,1,1,-0.5' -composite "$tmp_file_2"
convert "$enfuse_file" "$tmp_file_1" -compose dissolve -define compose:args=17.5,100 -composite "$tmp_file_3"
convert "$tmp_file_3" "$tmp_file_2" -compose dissolve -define compose:args=17.5,100 -composite "$final_file"


for file in "$enfuse_file" "$hdr_fattal_file" "$hdr_mantiuk_file" "$final_file"; do
    exiftool -m -overwrite_original_in_place -tagsfromfile "$exif_ref_file" "-all:all>all:all" "$file"
done

rm "$hdr_input"
rm "$tmp_file_1"
rm "$tmp_file_2"
rm "$tmp_file_3"
rm "$hdr_fattal_file"
rm "$hdr_mantiuk_file"
rm "$enfuse_file"
rm ALIGN_${CUR_VIEW}_*
