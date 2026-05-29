import { ICONS } from './icons'

const COLOR_CLASSES = {
  'icon-red': 'bg-red-500/15 text-red-400',
  'icon-green': 'bg-emerald-500/15 text-emerald-400',
  'icon-blue': 'bg-blue-500/15 text-blue-400',
  'icon-yellow': 'bg-amber-500/15 text-amber-400',
  'icon-purple': 'bg-violet-500/15 text-violet-400'
}

const resolveColorClass = (value) => COLOR_CLASSES[value] || value || ''

const makeSoonTool = (id, title, description, category, icon, colorClass, runtime = 'server') => ({
  id,
  title,
  description,
  category,
  icon,
  colorClass: resolveColorClass(colorClass),
  comingSoon: true,
  runtime
})

const TEXT_TOOLS = [
  {
    id: 'metadata-edit',
    title: 'Metadata Editor',
    description: 'View file details and export metadata sidecars locally.',
    category: 'text',
    icon: ICONS.document,
    colorClass: resolveColorClass('icon-purple')
  },
  {
    id: 'text-compare',
    title: 'Text Diff/Compare',
    description: 'Compare text and highlight line-by-line changes.',
    category: 'text',
    icon: ICONS.compare,
    colorClass: resolveColorClass('icon-purple')
  },
  {
    id: 'markdown-diff',
    title: 'Markdown Preview/Diff',
    description: 'Preview Markdown and compare revisions in the browser.',
    category: 'text',
    icon: ICONS.code,
    colorClass: resolveColorClass('icon-purple')
  },
  {
    id: 'hash-generator',
    title: 'Hash Generator',
    description: 'Generate MD5, SHA-1, or SHA-256 hashes locally.',
    category: 'text',
    icon: ICONS.hash,
    colorClass: resolveColorClass('icon-purple')
  },
  {
    id: 'base64-encode-decode',
    title: 'Base64 Encode/Decode',
    description: 'Encode or decode Base64 text instantly.',
    category: 'text',
    icon: ICONS.code,
    colorClass: resolveColorClass('icon-purple')
  },
  {
    id: 'hex-encode-decode',
    title: 'Hex Encode/Decode',
    description: 'Convert text to and from hexadecimal.',
    category: 'text',
    icon: ICONS.hash,
    colorClass: resolveColorClass('icon-purple')
  },
  {
    id: 'url-encode-decode',
    title: 'URL Encode/Decode',
    description: 'Encode or decode URL-safe strings.',
    category: 'text',
    icon: ICONS.link,
    colorClass: resolveColorClass('icon-purple')
  },
  {
    id: 'text-encoding-convert',
    title: 'Text Encoding Conversion',
    description: 'Convert text between common encodings.',
    category: 'text',
    icon: ICONS.compare,
    colorClass: resolveColorClass('icon-purple')
  }
]

const AUDIO_TOOLS = [
  {
    id: 'record-audio',
    title: 'Record Audio',
    description: 'Record audio from your microphone without leaving the browser.',
    category: 'audio',
    icon: ICONS.audio,
    colorClass: resolveColorClass('icon-yellow')
  }
]

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
  makeSoonTool('image-filters', 'Filters/Effects', 'Apply filters and effects.', 'image', ICONS.image, 'icon-green')
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
    colorClass: resolveColorClass('icon-yellow'),
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
    colorClass: resolveColorClass('icon-green'),
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
    colorClass: resolveColorClass('icon-yellow'),
    apiEndpoint: '/api/pdf/split'
  },
  {
    id: 'archive-extract',
    title: 'Archive Extract',
    description: 'Extract files from ZIP, RAR, 7Z, or TAR archives.',
    category: 'files',
    icon: ICONS.files,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/archive/extract',
    toolType: 'archive-extract'
  },
  {
    id: 'archive-create',
    title: 'Archive Create',
    description: 'Create ZIP, TAR, 7Z, or RAR archives from your files.',
    category: 'files',
    icon: ICONS.files,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/archive/create',
    toolType: 'archive-create'
  },
  {
    id: 'checksum-verify',
    title: 'Checksum Verification',
    description: 'Verify file checksums locally without uploading anything.',
    category: 'files',
    icon: ICONS.hash,
    colorClass: resolveColorClass('icon-blue'),
    toolType: 'checksum'
  },
  {
    id: 'performance-viewer',
    title: 'Performance Viewer',
    description: 'Monitor CPU, RAM, storage, network, and GPU activity in real time.',
    category: 'system',
    icon: ICONS.activity,
    colorClass: resolveColorClass('icon-purple'),
    runtime: 'server'
  },
  {
    id: 'internet-test',
    title: 'Internet Speed',
    description: 'Measure download and upload speeds using Cloudflare speed test endpoints.',
    category: 'system',
    icon: ICONS.speed,
    colorClass: resolveColorClass('icon-purple')
  },
  ...TEXT_TOOLS,
  ...AUDIO_TOOLS,
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
