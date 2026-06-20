const GITHUB_URL = 'https://github.com/hwttop5/TESTV'

export default function GitHubLink() {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="在 GitHub 上查看源代码"
      title="GitHub 仓库"
      className="flex h-10 w-10 items-center justify-center rounded-control border border-foreground/15 bg-background text-foreground/70 transition duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:text-foreground active:translate-y-0 active:scale-95"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path d="M12 1.27a11 11 0 0 0-3.48 21.46c.55.09.73-.24.73-.53v-1.85c-3.03.66-3.67-1.46-3.67-1.46-.5-1.27-1.21-1.61-1.21-1.61-.99-.68.07-.66.07-.66 1.1.08 1.67 1.13 1.67 1.13.97 1.67 2.55 1.19 3.17.91.1-.71.38-1.19.69-1.46-2.42-.28-4.96-1.21-4.96-5.38 0-1.19.42-2.16 1.13-2.92-.11-.28-.49-1.39.11-2.9 0 0 .92-.29 3.02 1.12a10.5 10.5 0 0 1 5.5 0c2.1-1.41 3.02-1.12 3.02-1.12.6 1.51.22 2.62.11 2.9.7.76 1.12 1.73 1.12 2.92 0 4.18-2.54 5.1-4.97 5.37.39.34.74 1 .74 2.02v3c0 .29.18.63.74.52A11 11 0 0 0 12 1.27z" />
      </svg>
    </a>
  )
}
