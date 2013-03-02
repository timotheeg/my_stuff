#!/bin/bash

##################################################
#
# Script to locate and optimize jpeg and png files
# 
# script depends on external tools:
# * pngout: http://www.jonof.id.au/pngout
# * jpegtran
# * gifsicle: http://www.lcdf.org/gifsicle/
# 
# Author: Timothee Groleau
#
##################################################

# set -x

function optimize_gifs {

    # make sure we have the latest from svn
	# find $1 -iname '*.gif' -delete
	# cd $1;
	# svn up
	# cd ..
	
	TMP_FILE=/tmp/dummy.gif

	find -E $1 -iname '*.gif' | sed -E -e 's#/+#/#g' | while read file;
	do
		gifsicle --optimize=3 --careful "$file" > $TMP_FILE

		success=$?
		if [ ! $success ];
		then
			printf "WARNING: gifsicle cannot process $file\n"
			continue
		fi

		AFTER=$(stat -f %z $TMP_FILE)

		if [ $AFTER -le 0 ];
		then
			printf "WARNING: gifsicle could not process $file\n"
			continue
		fi

		BEFORE=$(stat -f %z "$file")

		if [ $AFTER -lt $BEFORE ];
		then
			if [ $(gifdiff "$file" $TMP_FILE | wc -l) -le 0 ];
			then
				mv $TMP_FILE "$file"
				printf "$file was optimized: (%d -> %d)\n" $BEFORE $AFTER
			else
				rm $TMP_FILE
				printf "$file: WARNING: gifsicle generates a different file\n"
			fi
		else
			rm $TMP_FILE
			printf "$file is already optimized (%d)\n" $BEFORE
		fi
	done
}

function optimize_jpegs {

    # make sure we have the latest from svn
	# find $1 -iname '*.jpg' -delete
	# cd $1;
	# svn up
	# cd ..
	
	TMP_FILE=/tmp/dummy.jpg

	find -E $1 -iregex '.*\.jpe?g$' | sed -E -e 's#/+#/#g' | while read file;
	do
		jpegtran -copy none -optimize "$file" > $TMP_FILE

		success=$?
		if [ ! $success ];
		then
			printf "WARNING: jpegtran cannot process $file\n"
			continue
		fi

		AFTER=$(stat -f %z $TMP_FILE)

		if [ $AFTER -le 0 ];
		then
			printf "WARNING: jpegtran could not process $file\n"
			continue
		fi

		BEFORE=$(stat -f %z "$file")

		if [ $AFTER -lt $BEFORE ];
		then
			mv $TMP_FILE "$file"
			printf "$file was optimized: (%d -> %d)\n" $BEFORE $AFTER
		else
			rm $TMP_FILE
			printf "$file is already optimized\n"
		fi
	done
}

function optimize_pngs {

    # make sure we have the latest from svn 
	# cd $1
	# svn up
	# cd ..

	find $1 -iname '*.png' -exec pngout "{}" \;
}

function sync_to_dev {
	rsync -av --filter="+ *.jpg" --filter="+ *.png" --filter="- .svn/" --filter="- *.*" $1/ root@192.168.1.134:/var/www/htdocs/
}


while getopts "gpj" flag
do
    case "$flag" in 
        g) printf "Optimizing gifs\n"; optimize_gifs ./;;
        p) printf "Optimizing pngs\n"; optimize_pngs ./;;
        j) printf "Optimizing jpgs\n"; optimize_jpegs ./;;
    esac
done

# sync_to_dev  ./

