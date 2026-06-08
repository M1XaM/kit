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
    icon: ICONS.text,
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
    icon: ICONS.swap,
    colorClass: resolveColorClass('icon-purple')
  },
  {
    id: 'hex-encode-decode',
    title: 'Hex Encode/Decode',
    description: 'Convert text to and from hexadecimal.',
    category: 'text',
    icon: ICONS.code,
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
    icon: ICONS.sliders,
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
  },
  {
    id: 'merge-audio',
    title: 'Merge Audio',
    description: 'Combine multiple audio files into one — preview, reorder, then merge.',
    category: 'audio',
    icon: ICONS.layers,
    colorClass: resolveColorClass('icon-yellow'),
    toolType: 'audio-merge',
    runtime: 'client'
  },
  {
    id: 'adjust-audio',
    title: 'Adjust Bitrate/Sample Rate',
    description: 'Re-encode audio with a new bitrate and sample rate.',
    category: 'audio',
    icon: ICONS.sliders,
    colorClass: resolveColorClass('icon-yellow'),
    apiEndpoint: '/api/audio/adjust',
    toolType: 'video',
    runtime: 'server'
  },
  {
    id: 'record-video',
    title: 'Record Video',
    description: 'Record your camera with optional microphone and system audio.',
    category: 'audio',
    icon: ICONS.video,
    colorClass: resolveColorClass('icon-yellow'),
    toolType: 'video-record',
    runtime: 'client'
  }
]

// Video/audio editing tools. These re-encode media with ffmpeg, which is
// impractical in the browser, so the heavy lifting runs on the Go backend.
const VIDEO_TOOLS = [
  {
    id: 'trim-video',
    title: 'Trim Video',
    description: 'Trim videos to a selected range.',
    category: 'video',
    icon: ICONS.scissors,
    colorClass: resolveColorClass('icon-red'),
    apiEndpoint: '/api/video/trim',
    toolType: 'video',
    runtime: 'server'
  },
  {
    id: 'split-video',
    title: 'Cut/Split Video',
    description: 'Split videos into multiple clips.',
    category: 'video',
    icon: ICONS.scissors,
    colorClass: resolveColorClass('icon-red'),
    apiEndpoint: '/api/video/split',
    toolType: 'video',
    runtime: 'server'
  },
  {
    id: 'merge-video',
    title: 'Merge Video Clips',
    description: 'Combine multiple video clips into one file.',
    category: 'video',
    icon: ICONS.layers,
    colorClass: resolveColorClass('icon-red'),
    apiEndpoint: '/api/video/merge',
    toolType: 'video-merge',
    runtime: 'server'
  },
  {
    id: 'resize-video',
    title: 'Resize Video',
    description: 'Change video resolution or aspect.',
    category: 'video',
    icon: ICONS.crop,
    colorClass: resolveColorClass('icon-red'),
    apiEndpoint: '/api/video/resize',
    toolType: 'video',
    runtime: 'server'
  },
  {
    id: 'compress-video',
    title: 'Compress Video',
    description: 'Reduce video size while keeping quality.',
    category: 'video',
    icon: ICONS.compress,
    colorClass: resolveColorClass('icon-red'),
    apiEndpoint: '/api/video/compress',
    toolType: 'video',
    runtime: 'server'
  },
  {
    id: 'convert-video',
    title: 'Convert Video Formats',
    description: 'Convert videos between formats.',
    category: 'video',
    icon: ICONS.swap,
    colorClass: resolveColorClass('icon-red'),
    apiEndpoint: '/api/video/convert',
    toolType: 'video',
    runtime: 'server'
  },
  {
    id: 'trim-audio',
    title: 'Trim Audio',
    description: 'Trim audio clips in seconds.',
    category: 'video',
    icon: ICONS.scissors,
    colorClass: resolveColorClass('icon-red'),
    apiEndpoint: '/api/audio/trim',
    toolType: 'video',
    runtime: 'server'
  }
]

const DOCUMENT_TOOLS = [
  {
    id: 'merge-pdf',
    title: 'Merge PDF',
    description: 'Combine multiple PDFs into a single file.',
    category: 'documents',
    icon: ICONS.layers,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/pdf/merge',
    runtime: 'server'
  },
  {
    id: 'encrypt-decrypt-pdf',
    title: 'Encrypt/Decrypt PDF',
    description: 'Add or remove password protection from PDFs.',
    category: 'documents',
    icon: ICONS.lock,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/pdf/protect',
    runtime: 'server'
  },
  {
    id: 'extract-pages',
    title: 'Extract Pages',
    description: 'Extract selected pages into a new PDF.',
    category: 'documents',
    icon: ICONS.scissors,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/pdf/extract-pages',
    runtime: 'server'
  },
  {
    id: 'delete-pages',
    title: 'Delete Pages',
    description: 'Remove unwanted pages from a PDF.',
    category: 'documents',
    icon: ICONS.trash,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/pdf/delete-pages',
    runtime: 'server'
  },
  {
    id: 'reorder-pages',
    title: 'Reorder Pages',
    description: 'Rearrange PDF pages in any order.',
    category: 'documents',
    icon: ICONS.swap,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/pdf/reorder-pages',
    runtime: 'server'
  },
  {
    id: 'rotate-pages',
    title: 'Rotate Pages',
    description: 'Rotate PDF pages to the correct orientation.',
    category: 'documents',
    icon: ICONS.rotate,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/pdf/rotate',
    runtime: 'server'
  },
  {
    id: 'file-converter',
    title: 'File Converter',
    description: 'Convert images into a PDF and extract embedded images back out.',
    category: 'documents',
    icon: ICONS.swap,
    colorClass: resolveColorClass('icon-blue'),
    apiEndpoint: '/api/convert/image-to-pdf',
    runtime: 'server'
  }
]

const COMING_SOON_TOOLS = [
  makeSoonTool('ocr', 'OCR', 'Extract text from images and scans.', 'text', ICONS.sparkles, 'icon-purple'),
  makeSoonTool('extract-text-pdf', 'Extract Text from PDF', 'Pull plain text from PDF files.', 'text', ICONS.text, 'icon-purple'),
  makeSoonTool('watermark-documents', 'Watermark Documents', 'Apply image or page watermarks to documents.', 'text', ICONS.lock, 'icon-purple'),
  makeSoonTool('ai-summarize', 'AI Summarize', 'Summarize documents with AI.', 'ai-tools', ICONS.sparkles, 'icon-green'),
  makeSoonTool('convert-audio', 'Convert Audio Formats', 'Convert audio between formats.', 'audio', ICONS.swap, 'icon-yellow'),
  makeSoonTool('screen-recording', 'Screen Recording', 'Capture your screen with audio.', 'audio', ICONS.system, 'icon-yellow'),
  makeSoonTool('convert-image-formats', 'Convert Image Formats', 'Convert images between popular formats.', 'image', ICONS.swap, 'icon-green'),
  makeSoonTool('batch-image', 'Batch Image Processing', 'Process multiple images at once.', 'image', ICONS.layers, 'icon-green'),
  makeSoonTool('denoise-enhance', 'Denoise/Enhance', 'Enhance images and reduce noise.', 'image', ICONS.sparkles, 'icon-green'),
  makeSoonTool('watermark-image', 'Image Watermark', 'Add watermarks to your images.', 'image', ICONS.lock, 'icon-green')
]

// AI tools run a neural-net model locally via a bundled sidecar engine. Heavy
// inference happens on the Go side; weights are downloaded on demand from the
// feature page and can be deleted to reclaim storage.
const AI_TOOLS = [
  {
    id: 'ai-remove-background',
    title: 'AI Remove Background',
    description: 'Cut the subject out of any image with a local AI model — fully offline, nothing uploaded.',
    category: 'ai-tools',
    icon: ICONS.sparkles,
    colorClass: resolveColorClass('icon-green'),
    apiEndpoint: '/api/ai/remove-background',
    toolType: 'ai-remove-bg',
    runtime: 'server'
  }
]

// Image tools. Heavy, whole-image pixel work (resize, compress, borders,
// filters, collage) runs on the Go backend to bypass browser memory limits;
// inherently interactive tools (crop selection, palette swatches) run entirely
// client-side on a <canvas> for instant feedback and zero uploads.
const IMAGE_TOOLS = [
  {
    id: 'resize-image',
    title: 'Resize Image',
    description: 'Resize images by dimensions or percentage with high-quality resampling.',
    category: 'image',
    icon: ICONS.crop,
    colorClass: resolveColorClass('icon-green'),
    apiEndpoint: '/api/image/resize',
    toolType: 'image-server',
    runtime: 'server'
  },
  {
    id: 'compress-image',
    title: 'Compress Image',
    description: 'Shrink image file size with adjustable quality, optionally downscaling first.',
    category: 'image',
    icon: ICONS.compress,
    colorClass: resolveColorClass('icon-green'),
    apiEndpoint: '/api/image/compress',
    toolType: 'image-server',
    runtime: 'server'
  },
  {
    id: 'crop-rotate-flip',
    title: 'Crop/Rotate/Flip',
    description: 'Crop a selection, rotate, and flip images right in your browser.',
    category: 'image',
    icon: ICONS.crop,
    colorClass: resolveColorClass('icon-green'),
    toolType: 'image-crop',
    runtime: 'client'
  },
  {
    id: 'palette-extraction',
    title: 'Color Palette Extraction',
    description: 'Pull a dominant color palette from any image and copy the hex codes.',
    category: 'image',
    icon: ICONS.palette,
    colorClass: resolveColorClass('icon-green'),
    toolType: 'image-palette',
    runtime: 'client'
  },
  {
    id: 'image-collage',
    title: 'Image Collage/Grid',
    description: 'Arrange multiple images into a clean grid collage.',
    category: 'image',
    icon: ICONS.grid,
    colorClass: resolveColorClass('icon-green'),
    apiEndpoint: '/api/image/collage',
    toolType: 'image-collage',
    runtime: 'server'
  },
  {
    id: 'image-borders',
    title: 'Borders/Rounded Corners',
    description: 'Add a solid border and rounded corners with transparency.',
    category: 'image',
    icon: ICONS.crop,
    colorClass: resolveColorClass('icon-green'),
    apiEndpoint: '/api/image/border',
    toolType: 'image-server',
    runtime: 'server'
  },
  {
    id: 'image-filters',
    title: 'Filters/Effects',
    description: 'Apply grayscale, sepia, blur, sharpen, brightness, contrast and more.',
    category: 'image',
    icon: ICONS.sliders,
    colorClass: resolveColorClass('icon-green'),
    apiEndpoint: '/api/image/filter',
    toolType: 'image-server',
    runtime: 'server'
  }
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
  ...DOCUMENT_TOOLS,
  ...TEXT_TOOLS,
  ...AUDIO_TOOLS,
  ...VIDEO_TOOLS,
  ...IMAGE_TOOLS,
  ...AI_TOOLS,
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
