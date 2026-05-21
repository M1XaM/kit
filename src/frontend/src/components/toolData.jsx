import { ICONS } from './icons'

const makeSoonTool = (id, title, description, category, icon, colorClass) => ({
  id,
  title,
  description,
  category,
  icon,
  colorClass,
  comingSoon: true
})

const COMING_SOON_TOOLS = [
  makeSoonTool('merge-pdf', 'Merge PDF', 'Combine multiple PDFs into a single file.', 'documents', ICONS.document, 'icon-blue'),
  makeSoonTool('encrypt-decrypt-pdf', 'Encrypt/Decrypt PDF', 'Add or remove password protection from PDFs.', 'documents', ICONS.document, 'icon-blue'),
  makeSoonTool('extract-pages', 'Extract Pages', 'Extract selected pages into a new PDF.', 'documents', ICONS.document, 'icon-blue'),
  makeSoonTool('delete-pages', 'Delete Pages', 'Remove unwanted pages from a PDF.', 'documents', ICONS.document, 'icon-blue'),
  makeSoonTool('reorder-pages', 'Reorder Pages', 'Rearrange PDF pages in any order.', 'documents', ICONS.document, 'icon-blue'),
  makeSoonTool('rotate-pages', 'Rotate Pages', 'Rotate PDF pages to the correct orientation.', 'documents', ICONS.document, 'icon-blue'),
  makeSoonTool('file-converter', 'File Converter', 'Convert documents between common formats.', 'documents', ICONS.document, 'icon-blue'),
  makeSoonTool('ocr', 'OCR', 'Extract text from images and scans.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('extract-text-pdf', 'Extract Text from PDF', 'Pull plain text from PDF files.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('watermark-documents', 'Watermark Documents', 'Apply image or page watermarks to documents.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('metadata-edit', 'Metadata Editor', 'View and edit document metadata.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('text-compare', 'Text Diff/Compare', 'Compare text and highlight changes.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('markdown-diff', 'Markdown Preview/Diff', 'Preview Markdown and compare revisions.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('hash-generator', 'Hash Generator', 'Generate MD5, SHA-1, or SHA-256 hashes.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('base64-encode-decode', 'Base64 Encode/Decode', 'Encode or decode Base64 text.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('hex-encode-decode', 'Hex Encode/Decode', 'Convert text to and from hex.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('url-encode-decode', 'URL Encode/Decode', 'Encode or decode URL-safe strings.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('text-encoding-convert', 'Text Encoding Conversion', 'Convert between common text encodings.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('ai-summarize', 'AI Summarize', 'Summarize documents with AI.', 'ai-tools', ICONS.ai, 'icon-green'),
  makeSoonTool('ai-remove-background', 'AI Remove Background', 'Remove image backgrounds with AI.', 'ai-tools', ICONS.ai, 'icon-green'),
  makeSoonTool('trim-video', 'Trim Video', 'Trim videos to a selected range.', 'video', ICONS.video, 'icon-red'),
  makeSoonTool('split-video', 'Cut/Split Video', 'Split videos into multiple clips.', 'video', ICONS.video, 'icon-red'),
  makeSoonTool('merge-video', 'Merge Video Clips', 'Combine video clips into one file.', 'video', ICONS.video, 'icon-red'),
  makeSoonTool('resize-video', 'Resize Video', 'Change video resolution or aspect.', 'video', ICONS.video, 'icon-red'),
  makeSoonTool('compress-video', 'Compress Video', 'Reduce video size while keeping quality.', 'video', ICONS.video, 'icon-red'),
  makeSoonTool('convert-video', 'Convert Video Formats', 'Convert videos between formats.', 'video', ICONS.video, 'icon-red'),
  makeSoonTool('trim-audio', 'Trim Audio', 'Trim audio clips in seconds.', 'video', ICONS.video, 'icon-red'),
  makeSoonTool('merge-audio', 'Merge Audio', 'Combine audio tracks into one file.', 'audio', ICONS.audio, 'icon-yellow'),
  makeSoonTool('convert-audio', 'Convert Audio Formats', 'Convert audio between formats.', 'audio', ICONS.audio, 'icon-yellow'),
  makeSoonTool('adjust-audio', 'Adjust Bitrate/Sample Rate', 'Adjust bitrate and sample rate.', 'audio', ICONS.audio, 'icon-yellow'),
  makeSoonTool('record-audio', 'Record Audio', 'Record audio from your microphone.', 'audio', ICONS.audio, 'icon-yellow'),
  makeSoonTool('record-video', 'Record Video', 'Record video using your camera.', 'audio', ICONS.audio, 'icon-yellow'),
  makeSoonTool('screen-recording', 'Screen Recording', 'Capture your screen with audio.', 'audio', ICONS.audio, 'icon-yellow'),
  makeSoonTool('resize-image', 'Resize Image', 'Resize images by dimensions or size.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('compress-image', 'Compress Image', 'Shrink images while keeping quality.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('convert-image-formats', 'Convert Image Formats', 'Convert images between popular formats.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('crop-rotate-flip', 'Crop/Rotate/Flip', 'Crop, rotate, or flip images.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('batch-image', 'Batch Image Processing', 'Process multiple images at once.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('denoise-enhance', 'Denoise/Enhance', 'Enhance images and reduce noise.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('palette-extraction', 'Color Palette Extraction', 'Extract color palettes from images.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('image-collage', 'Image Collage/Grid', 'Build collages or image grids.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('watermark-image', 'Image Watermark', 'Add watermarks to your images.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('image-borders', 'Borders/Rounded Corners', 'Add borders or rounded corners.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('image-filters', 'Filters/Effects', 'Apply filters and effects.', 'image', ICONS.image, 'icon-green'),
  makeSoonTool('archive-extract', 'Archive Extract', 'Extract files from ZIP, RAR, or TAR.', 'files', ICONS.files, 'icon-blue'),
  makeSoonTool('archive-create', 'Archive Create', 'Create ZIP, RAR, or TAR archives.', 'files', ICONS.files, 'icon-blue'),
  makeSoonTool('checksum-verify', 'Checksum Verification', 'Verify checksums for files.', 'files', ICONS.files, 'icon-blue')
]

export const TOOLS = [
  {
    id: 'png-to-jpg',
    title: 'PNG to JPG',
    description: 'Convert PNG images to JPG in seconds. Easily handled locally to bypass limits.',
    category: 'image',
    icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    ),
    colorClass: 'icon-yellow',
    apiEndpoint: '/api/convert/png-to-jpg'
  },
  {
    id: 'compress-pdf',
    title: 'Compress PDF',
    description: 'Reduce file size while optimizing for maximal PDF quality.',
    category: 'documents',
    icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
        <path d="M12 12v9"></path>
        <path d="m8 17 4 4 4-4"></path>
      </svg>
    ),
    colorClass: 'icon-green',
    apiEndpoint: '/api/pdf/compress'
  },
  {
    id: 'split-pdf',
    title: 'Split PDF',
    description: 'Split PDF pages by custom range or export each page into its own file.',
    category: 'documents',
    icon: () => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18"></path>
        <path d="M6 3h12"></path>
        <path d="M6 21h12"></path>
        <path d="M4 8h4"></path>
        <path d="M4 16h4"></path>
        <path d="M16 8h4"></path>
        <path d="M16 16h4"></path>
      </svg>
    ),
    colorClass: 'icon-yellow',
    apiEndpoint: '/api/pdf/split'
  },
  {
    id: 'performance-viewer',
    title: 'Performance Viewer',
    description: 'Monitor CPU, RAM, storage, network, and GPU activity in real time.',
    category: 'system',
    icon: ICONS.system,
    colorClass: 'icon-purple'
  },
  {
    id: 'internet-test',
    title: 'Internet Speed',
    description: 'Measure download and upload speeds using Cloudflare speed test endpoints.',
    category: 'system',
    icon: ICONS.system,
    colorClass: 'icon-purple'
  },
  ...COMING_SOON_TOOLS
]

export const CATEGORY_SECTIONS = [
  {
    id: 'documents',
    title: 'Documents',
    toolIds: [
      'merge-pdf',
      'encrypt-decrypt-pdf',
      'extract-pages',
      'split-pdf',
      'delete-pages',
      'reorder-pages',
      'rotate-pages',
      'file-converter',
      'compress-pdf'
    ]
  },
  {
    id: 'text',
    title: 'Text',
    toolIds: [
      'ocr',
      'extract-text-pdf',
      'watermark-documents',
      'metadata-edit',
      'text-compare',
      'markdown-diff',
      'hash-generator',
      'base64-encode-decode',
      'hex-encode-decode',
      'url-encode-decode',
      'text-encoding-convert'
    ]
  },
  {
    id: 'ai-tools',
    title: 'AI Tools',
    toolIds: [
      'ai-summarize',
      'ai-remove-background'
    ]
  },
  {
    id: 'video',
    title: 'Video',
    toolIds: [
      'trim-video',
      'split-video',
      'merge-video',
      'resize-video',
      'compress-video',
      'convert-video',
      'trim-audio'
    ]
  },
  {
    id: 'audio',
    title: 'Audio',
    toolIds: [
      'merge-audio',
      'convert-audio',
      'adjust-audio',
      'record-audio',
      'record-video',
      'screen-recording'
    ]
  },
  {
    id: 'image',
    title: 'Image',
    toolIds: [
      'resize-image',
      'compress-image',
      'convert-image-formats',
      'png-to-jpg',
      'crop-rotate-flip',
      'batch-image',
      'denoise-enhance',
      'palette-extraction',
      'image-collage',
      'watermark-image',
      'image-borders',
      'image-filters'
    ]
  },
  {
    id: 'files',
    title: 'Files',
    toolIds: [
      'archive-extract',
      'archive-create',
      'checksum-verify'
    ]
  },
  {
    id: 'system',
    title: 'System',
    toolIds: [
      'performance-viewer',
      'internet-test'
    ]
  }
]
