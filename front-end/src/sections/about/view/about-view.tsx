import { AboutHero } from '../about-hero';
import { AboutTeam } from '../about-team';
import { AboutWhat } from '../about-what';
import { AboutVision } from '../about-vision';
import { AboutTestimonials } from '../about-testimonials';

// ----------------------------------------------------------------------

export function AboutView() {
  return (
    <>
      <AboutHero />

      <AboutWhat />

      <AboutVision />

      <AboutTeam />

      <AboutTestimonials />
    </>
  );
}
