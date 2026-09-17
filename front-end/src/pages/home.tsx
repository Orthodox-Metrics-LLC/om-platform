import { HomeView } from 'src/sections/home/view';

// ----------------------------------------------------------------------

const metadata = {
  title: 'Orthodox Metrics — Preserve your parish history',
  description:
    'The modern platform for baptism, marriage, and funeral registers — digitization, search, and stewardship in one place.',
};

export default function Page() {
  return (
    <>
      <title>{metadata.title}</title>
      <meta name="description" content={metadata.description} />

      <HomeView />
    </>
  );
}
