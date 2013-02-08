#!/bin/bash

set -x
exiftool -tagsFromFile "$1" -overwrite_original "$2"; touch -r "$1" "$2" 
