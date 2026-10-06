Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

$bounds = [System.Drawing.RectangleF]::new(10, 10, 236, 236)
$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$radius = 50.0
$diameter = $radius * 2
$path.AddArc($bounds.X, $bounds.Y, $diameter, $diameter, 180, 90)
$path.AddArc($bounds.Right - $diameter, $bounds.Y, $diameter, $diameter, 270, 90)
$path.AddArc($bounds.Right - $diameter, $bounds.Bottom - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc($bounds.X, $bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()
$graphics.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(24, 24, 27)), $path)

$font = [System.Drawing.Font]::new('Arial', 166, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('c', $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(9, -7, 238, 259), $format)

$handle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($handle)
$stream = [System.IO.File]::Open((Join-Path $PSScriptRoot '..\resources\captured.ico'), [System.IO.FileMode]::Create)
try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose(); $bitmap.Dispose(); $graphics.Dispose(); $font.Dispose(); $format.Dispose(); $path.Dispose() }
