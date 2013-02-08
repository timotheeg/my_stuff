<?php

$save_dir = dirname(__FILE__);
$checkpoint_file = "mangareader_checkpoint.txt";
$max_failures = 3;

$page_url = null;

$confs = array
(
  'mangareader' => array(
    'base_path' => 'http://www.mangareader.net',
    'regex' => '/<a href="(?<page_url>[^"]+)"><img id="img" width="[0-9]+" height="[0-9]+" src="(?<img_url>[^"]+)" alt="(?<title>.+) (?<chapter>[0-9]+) - Page (?<page>[0-9]+)"/Sm',
  ),
  'mangatraders' => array(
    'base_path' => 'http://www.mangatraders.com',
    'regex' => '/<img id="image" src="(?<img_url>[^"]+)" onload="(?:[^"]+)" alt="(?<title>.+) v\d+ c(?<chapter>[0-9-]+) Page (?<page>\d+)".+<area id="nextArea" href="(?<page_url>[^"]+)"/Sms',
  ),
  'manga.animea.net' => array(
    'base_path' => 'http://manga.animea.net/',
    'regex' => '/<title>(?<title>.+) chapter (?<chapter>\d+) - Page (?<page>\d+) of \d+.+<a +(onclick="[^"]+" )?href="(?<page_url>[^"]+)"><img src="(?<img_url>[^"]+)" onerror="[^"]+" class="mangaimg" /Sms',
  )
);

if (!isset($confs[$argv[1]]))
{
	die("invalid profile");
}

$profile = $confs[$argv[1]];

if (is_readable($checkpoint_file))
{
	$page_url = trim(file_get_contents($checkpoint_file));
}

if (is_null($page_url))
{
	die ("no start page found");
}

do
{
	$failures = $max_failures;
	do
	{
		printf("downloading [%s]\n", $profile['base_path'] . $page_url);
		$html = @file_get_contents($profile['base_path'] . $page_url);
	}
	while (!$html && $failures-- > 0);
	
	if (!$html)
	{
		fprintf(STDERR, "could not download page %s\n", $page_url);
		break;
	}
	
	if (!preg_match($profile['regex'], $html, $matches))
	{
		fprintf(STDERR, "No image found in page %s -- stopping\n", $page_url);
		break;
	}
	
	$page_url = $matches['page_url'];
	$img_url  = $matches['img_url'];
	$title    = str_replace(' ', '_', ucwords(strtolower($matches['title'])));
	$chapter  = $matches['chapter'];
	$page     = intval($matches['page']);
	
	$failures = $max_failures;
	do
	{
		printf("downloading %s, chapter %s, page %03d: %s\n", $title, $chapter, $page, $img_url);
		$img = @file_get_contents($img_url);
	}
	while (!$img && $failures-- > 0);

	if (!$img)
	{
		fprintf(STDERR, "could not download image %s -- skipping\n", $img_url);
	}
	else
	{
		@mkdir("$save_dir/$title", 0777, true);
		file_put_contents(sprintf("$save_dir/$title/c%s_p%03d.jpg", $chapter, $page), $img);
	}
	
	if (preg_match('/^javascript:/', $page_url))
	{
		fprintf(STDERR, "Invalid next url [%s] -- stopping\n", $page_url);
		break;
	}
	
	file_put_contents("$save_dir/$title/$checkpoint_file", $page_url);
}
while(true);

/*
function normalize_url($url, $reference_page)
{
  if (preg_match('/^https?:/i', $url)) return $url;
  if (preg_match('#^/#i', $url))
  {
    $fields = parse_url($reference_page);
    $fields['path'] = $url;
    return http_build_url($fields);
  }
}
/**/