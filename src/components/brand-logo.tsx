import Image from 'next/image';

export function BrandLogo({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 rounded bg-white">
      <Image
        alt=""
        className="opacity-65"
        height={size}
        src="/brand/markdock.svg"
        unoptimized
        width={size}
      />
    </span>
  );
}
