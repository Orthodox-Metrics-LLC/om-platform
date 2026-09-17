// ----------------------------------------------------------------------

/**
 * Legal and security copy, ported from the existing Orthodox Metrics public
 * site (`features/public-site/pages/{Terms,Privacy,Security}.tsx`).
 *
 * This text is deliberately NOT translated. Terms of service, privacy policy,
 * and security statements require per-jurisdiction legal review before being
 * restated in another language; until that exists the English here is the
 * source of truth. Do not paraphrase or "tidy" these strings — change them only
 * alongside the same change on the main site.
 */

export const LEGAL_COMPANY = 'Orthodox Metrics LLC';
export const LEGAL_EMAIL = 'info@orthodoxmetrics.com';
export const LEGAL_WEBSITE = 'https://orthodoxmetrics.com';
export const LEGAL_EFFECTIVE_DATE = 'May 6, 2026';

const GOVERNING_STATE = 'New Jersey';
const POSTAL_ADDRESS = '48 Limerick Ln, Phillipsburg NJ 08865';

export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  /** Renders the company block with `LEGAL_EMAIL` as a mailto link. */
  | { type: 'contact'; lines?: string[] };

export type LegalSection = { title: string; blocks: LegalBlock[] };

export type LegalDocument = {
  slug: string;
  title: string;
  /** Meta description. */
  description: string;
  intro: string;
  showCompany?: boolean;
  sections: LegalSection[];
};

// ----------------------------------------------------------------------

export const TERMS_DOCUMENT: LegalDocument = {
  slug: 'terms',
  title: 'Terms of Service',
  description:
    'Terms of Service for Orthodox Metrics — accounts, customer data, billing, acceptable use, third parties, IP, liability, and governing law.',
  intro:
    'These Terms of Service govern your use of Orthodox Metrics, including our website, software platform, tools, and related services.',
  showCompany: true,
  sections: [
    {
      title: '1. Acceptance of Terms',
      blocks: [
        {
          type: 'p',
          text: 'By accessing or using Orthodox Metrics, you agree to these Terms. If you do not agree, do not use the service.',
        },
      ],
    },
    {
      title: '2. Description of Service',
      blocks: [
        {
          type: 'p',
          text: 'Orthodox Metrics provides software tools for Orthodox churches and church administrators, including parish records management, sacramental records, certificate tools, OCR-assisted document processing, administrative workflows, reporting, and related operational features.',
        },
      ],
    },
    {
      title: '3. Accounts and Authorized Users',
      blocks: [
        {
          type: 'p',
          text: 'You are responsible for maintaining the confidentiality of your account credentials. You are responsible for all activity under your account.',
        },
        {
          type: 'p',
          text: 'Churches and organizations are responsible for determining which users are authorized to access their data.',
        },
      ],
    },
    {
      title: '4. Customer Data',
      blocks: [
        { type: 'p', text: 'You retain ownership of the data you submit to Orthodox Metrics.' },
        {
          type: 'p',
          text: 'You grant us permission to host, process, store, transmit, and display your data only as needed to provide, secure, maintain, and improve the service.',
        },
        {
          type: 'p',
          text: 'You are responsible for ensuring that you have the right to submit and manage any church, parish, clergy, member, sacramental, document, or administrative data entered into the platform.',
        },
      ],
    },
    {
      title: '5. Accuracy of Records',
      blocks: [
        {
          type: 'p',
          text: 'Orthodox Metrics provides software tools to assist with recordkeeping and administration. We do not guarantee that records, certificates, OCR output, reports, or generated documents are legally, ecclesiastically, or administratively correct.',
        },
        {
          type: 'p',
          text: 'You are responsible for reviewing and verifying all records, certificates, reports, and documents before relying on them.',
        },
      ],
    },
    {
      title: '6. Subscriptions, Billing, and Payments',
      blocks: [
        {
          type: 'p',
          text: 'Some services may require paid subscriptions or fees. By purchasing a subscription, you authorize us and our payment processor to charge applicable fees.',
        },
        {
          type: 'p',
          text: 'Fees, billing cycles, cancellation terms, and subscription details may be shown during checkout or within your account.',
        },
        {
          type: 'p',
          text: 'Unless otherwise stated, fees are non-refundable except where required by law or agreed in writing.',
        },
      ],
    },
    {
      title: '7. Acceptable Use',
      blocks: [
        { type: 'p', text: 'You agree not to:' },
        {
          type: 'ul',
          items: [
            'Use the service for unlawful purposes',
            'Access data without authorization',
            'Attempt to disrupt, damage, reverse engineer, or compromise the platform',
            'Upload malicious code or harmful content',
            'Misrepresent your identity or authority',
            'Use the service to violate privacy, security, or data protection obligations',
          ],
        },
      ],
    },
    {
      title: '8. Service Availability',
      blocks: [
        {
          type: 'p',
          text: 'We aim to provide reliable service, but we do not guarantee uninterrupted availability. We may modify, suspend, or discontinue parts of the service as needed for maintenance, security, upgrades, or operational reasons.',
        },
      ],
    },
    {
      title: '9. Third-Party Services',
      blocks: [
        {
          type: 'p',
          text: 'Orthodox Metrics may integrate with third-party services such as payment processors, email providers, hosting providers, analytics tools, or other software services. Your use of those services may be subject to their own terms and policies.',
        },
      ],
    },
    {
      title: '10. Intellectual Property',
      blocks: [
        {
          type: 'p',
          text: `Orthodox Metrics, including its software, design, branding, workflows, documentation, and platform features, is owned by ${LEGAL_COMPANY} or its licensors.`,
        },
        {
          type: 'p',
          text: 'You may not copy, modify, distribute, resell, or create derivative works from the platform except as expressly permitted.',
        },
      ],
    },
    {
      title: '11. Confidentiality',
      blocks: [
        {
          type: 'p',
          text: 'Users may have access to sensitive church, administrative, or member information. You agree to use such information only for authorized purposes and to protect it from unauthorized access or disclosure.',
        },
      ],
    },
    {
      title: '12. Termination',
      blocks: [
        {
          type: 'p',
          text: 'We may suspend or terminate access if you violate these Terms, fail to pay required fees, misuse the platform, create security risk, or use the service unlawfully.',
        },
        {
          type: 'p',
          text: 'You may stop using the service at any time. Data export or deletion may be subject to account status, technical limits, backup retention, and legal obligations.',
        },
      ],
    },
    {
      title: '13. Disclaimer of Warranties',
      blocks: [
        {
          type: 'p',
          text: 'The service is provided “as is” and “as available.” To the maximum extent permitted by law, we disclaim warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, availability, and error-free operation.',
        },
      ],
    },
    {
      title: '14. Limitation of Liability',
      blocks: [
        {
          type: 'p',
          text: `To the maximum extent permitted by law, ${LEGAL_COMPANY} will not be liable for indirect, incidental, special, consequential, punitive, or lost-profit damages.`,
        },
        {
          type: 'p',
          text: 'Our total liability for any claim related to the service will not exceed the amount paid by you to us for the service during the three months before the claim arose.',
        },
      ],
    },
    {
      title: '15. Indemnification',
      blocks: [
        {
          type: 'p',
          text: `You agree to indemnify and hold harmless ${LEGAL_COMPANY} from claims, damages, liabilities, and expenses arising from your use of the service, your data, your violation of these Terms, or your violation of applicable law or third-party rights.`,
        },
      ],
    },
    {
      title: '16. Governing Law',
      blocks: [
        {
          type: 'p',
          text: `These Terms are governed by the laws of the State of ${GOVERNING_STATE}, without regard to conflict-of-law rules.`,
        },
      ],
    },
    {
      title: '17. Changes to Terms',
      blocks: [
        {
          type: 'p',
          text: 'We may update these Terms from time to time. Updated versions will be posted on this page with a revised effective date.',
        },
      ],
    },
    {
      title: '18. Contact',
      blocks: [
        { type: 'p', text: 'For questions about these Terms, contact:' },
        { type: 'contact', lines: [LEGAL_COMPANY, POSTAL_ADDRESS] },
      ],
    },
  ],
};

// ----------------------------------------------------------------------

export const PRIVACY_DOCUMENT: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy Policy',
  description:
    'How Orthodox Metrics collects, uses, stores, and protects information — data collection, payments, sharing, cookies, retention, and your choices.',
  intro:
    'Orthodox Metrics respects your privacy. This Privacy Policy explains how we collect, use, store, and protect information when you use our website, software platform, and related services.',
  showCompany: true,
  sections: [
    {
      title: '1. Information We Collect',
      blocks: [
        { type: 'p', text: 'We may collect the following types of information:' },
        {
          type: 'ul',
          items: [
            'Name, email address, phone number, organization name, and account details',
            'Church, parish, clergy, administrator, and member information entered into the platform',
            'Sacramental, administrative, certificate, record, OCR, and document-processing data submitted by authorized users',
            'Billing and subscription information',
            'Technical data such as IP address, browser type, device information, log data, and usage activity',
            'Communications you send to us through forms, email, support requests, or account interactions',
          ],
        },
      ],
    },
    {
      title: '2. Payment Information',
      blocks: [
        {
          type: 'p',
          text: 'We use Stripe or another third-party payment processor to process payments. We do not intentionally store full credit card numbers on our own servers. Payment information is handled by our payment processor according to its own privacy and security practices.',
        },
      ],
    },
    {
      title: '3. How We Use Information',
      blocks: [
        { type: 'p', text: 'We use collected information to:' },
        {
          type: 'ul',
          items: [
            'Provide and operate the Orthodox Metrics platform',
            'Manage user accounts, churches, subscriptions, billing, and support',
            'Process and organize church records, certificates, documents, and administrative workflows',
            'Improve security, reliability, performance, and user experience',
            'Communicate with users about accounts, support, updates, and service notices',
            'Comply with legal, security, tax, and operational obligations',
          ],
        },
      ],
    },
    {
      title: '4. Church and Member Data',
      blocks: [
        {
          type: 'p',
          text: 'Churches and authorized administrators are responsible for the accuracy, authorization, and lawful use of data they enter into Orthodox Metrics. We process this information only to provide the platform and related services.',
        },
      ],
    },
    {
      title: '5. Sharing of Information',
      blocks: [
        { type: 'p', text: 'We do not sell personal information.' },
        { type: 'p', text: 'We may share information with:' },
        {
          type: 'ul',
          items: [
            'Payment processors',
            'Hosting, infrastructure, email, analytics, and support providers',
            'Authorized church administrators or account users',
            'Legal, regulatory, or security authorities when required',
            'Successors in the event of a merger, acquisition, restructuring, or sale of assets',
          ],
        },
      ],
    },
    {
      title: '6. Cookies and Analytics',
      blocks: [
        {
          type: 'p',
          text: 'We may use cookies, session storage, analytics tools, and similar technologies to keep users signed in, improve the website, understand platform usage, and maintain security.',
        },
      ],
    },
    {
      title: '7. Data Security',
      blocks: [
        {
          type: 'p',
          text: 'We use reasonable administrative, technical, and organizational safeguards to protect information. No system is completely secure, and we cannot guarantee absolute security.',
        },
      ],
    },
    {
      title: '8. Data Retention',
      blocks: [
        {
          type: 'p',
          text: 'We retain information for as long as needed to provide services, comply with legal obligations, resolve disputes, maintain backups, and enforce agreements. Churches may request deletion or export of their data subject to account status, legal requirements, and technical limitations.',
        },
      ],
    },
    {
      title: '9. Your Choices',
      blocks: [
        {
          type: 'p',
          text: 'You may contact us to request access, correction, export, or deletion of personal information, where legally and technically applicable.',
        },
      ],
    },
    {
      title: '10. Children’s Privacy',
      blocks: [
        {
          type: 'p',
          text: 'Orthodox Metrics is intended for use by churches, clergy, administrators, and authorized adult users. We do not knowingly collect information directly from children under 13 without appropriate authorization.',
        },
      ],
    },
    {
      title: '11. Third-Party Links',
      blocks: [
        {
          type: 'p',
          text: 'Our website or platform may link to third-party websites or services. We are not responsible for the privacy practices of those third parties.',
        },
      ],
    },
    {
      title: '12. Changes to This Policy',
      blocks: [
        {
          type: 'p',
          text: 'We may update this Privacy Policy from time to time. Updated versions will be posted on this page with a revised effective date.',
        },
      ],
    },
    {
      title: '13. Contact',
      blocks: [
        { type: 'p', text: 'For privacy questions, contact:' },
        { type: 'contact', lines: [LEGAL_COMPANY, '48 Limerick Ln'] },
      ],
    },
  ],
};

// ----------------------------------------------------------------------

export const SECURITY_DOCUMENT: LegalDocument = {
  slug: 'security',
  title: 'Security',
  description:
    'How Orthodox Metrics secures parish data — secure access, encryption, payment security, data protection, backups, monitoring, and responsible disclosure.',
  intro:
    'Orthodox Metrics takes security seriously. Our platform is designed to help Orthodox churches manage sensitive administrative, parish, sacramental, and document-related data in a secure and responsible way.',
  sections: [
    {
      title: '1. Secure Access',
      blocks: [
        {
          type: 'p',
          text: 'Orthodox Metrics uses authenticated user accounts to control access to the platform. Access to church records, administrative tools, and account data is limited to authorized users based on their assigned permissions.',
        },
        {
          type: 'p',
          text: 'Users are responsible for protecting their login credentials and ensuring that only authorized personnel access their church or organization account.',
        },
      ],
    },
    {
      title: '2. Encryption',
      blocks: [
        {
          type: 'p',
          text: 'We use HTTPS/TLS encryption to protect data transmitted between your browser and our platform.',
        },
        {
          type: 'p',
          text: 'Where appropriate, sensitive data is protected using industry-standard security practices for storage, transmission, and access control.',
        },
      ],
    },
    {
      title: '3. Payment Security',
      blocks: [
        {
          type: 'p',
          text: 'Payments are processed through Stripe or another trusted third-party payment processor. Orthodox Metrics does not intentionally store full credit card numbers on its own servers.',
        },
        {
          type: 'p',
          text: 'Payment information is handled by the payment processor according to its own security and compliance standards.',
        },
      ],
    },
    {
      title: '4. Data Protection',
      blocks: [
        {
          type: 'p',
          text: 'Orthodox Metrics applies reasonable administrative, technical, and organizational safeguards to protect customer data from unauthorized access, misuse, loss, or disclosure.',
        },
        { type: 'p', text: 'These safeguards may include:' },
        {
          type: 'ul',
          items: [
            'Account authentication',
            'Role-based access controls',
            'Secure server configuration',
            'Database access restrictions',
            'Activity logging',
            'Backup procedures',
            'Software updates and maintenance',
            'Separation of customer and administrative access where appropriate',
          ],
        },
      ],
    },
    {
      title: '5. Church and Member Records',
      blocks: [
        {
          type: 'p',
          text: 'Churches may use Orthodox Metrics to manage sensitive records, including parish, clergy, member, sacramental, certificate, OCR, and document-processing information.',
        },
        {
          type: 'p',
          text: 'Each church or organization is responsible for determining who is authorized to access, edit, export, or manage its records.',
        },
      ],
    },
    {
      title: '6. Backups and Availability',
      blocks: [
        {
          type: 'p',
          text: 'We use backup and recovery practices intended to reduce the risk of data loss and support service continuity.',
        },
        {
          type: 'p',
          text: 'No system can guarantee uninterrupted operation, but we work to maintain a reliable and secure platform.',
        },
      ],
    },
    {
      title: '7. Monitoring and Maintenance',
      blocks: [
        {
          type: 'p',
          text: 'We may monitor platform activity, system logs, authentication activity, and operational health to detect errors, abuse, unauthorized access attempts, or security issues.',
        },
        {
          type: 'p',
          text: 'We also perform maintenance, updates, and infrastructure improvements to help keep the platform secure and stable.',
        },
      ],
    },
    {
      title: '8. Third-Party Providers',
      blocks: [
        {
          type: 'p',
          text: 'Orthodox Metrics may use trusted third-party providers for hosting, payment processing, email delivery, analytics, infrastructure, monitoring, and support.',
        },
        {
          type: 'p',
          text: 'These providers are used only as needed to operate, secure, and improve the service.',
        },
      ],
    },
    {
      title: '9. Responsible Disclosure',
      blocks: [
        {
          type: 'p',
          text: 'If you believe you have discovered a security issue, please contact us immediately.',
        },
        {
          type: 'p',
          text: 'Do not attempt to access, modify, delete, or disclose data that does not belong to you. We ask that security reports be made responsibly and in good faith.',
        },
        { type: 'p', text: 'Security reports can be sent to:' },
        { type: 'contact' },
      ],
    },
    {
      title: '10. No Absolute Guarantee',
      blocks: [
        {
          type: 'p',
          text: 'While we take security seriously and use reasonable safeguards, no internet-based service can be guaranteed to be completely secure.',
        },
        {
          type: 'p',
          text: 'Customers should use strong passwords, limit user access to trusted individuals, and promptly notify us of any suspected unauthorized access.',
        },
      ],
    },
    {
      title: '11. Contact',
      blocks: [
        { type: 'p', text: 'For security questions, contact:' },
        { type: 'contact', lines: ['Orthodox Metrics'] },
      ],
    },
  ],
};
