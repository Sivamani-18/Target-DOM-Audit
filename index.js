(() => {
  const DEFAULT_COMPONENT_NAME = 'banner';
  const DEFAULT_EXPECTED_PAGE_NAME = null;

  const ATTR = 'data-target-id';
  const INTERACTIVE =
    'a, button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
  const ELEMENT_ID_ATTRS = ['id', 'data-element-id'];
  const MESSAGE_TYPE = 'run-target-dom-audit';

  const clean = value => String(value ?? '').trim();
  const isCtaId = id => /-cta_[A-Za-z0-9]+$/.test(id);
  const escapeCss = value =>
    window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');

  function runTargetDomAudit(options = {}) {
    const componentName = clean(options.componentName) || DEFAULT_COMPONENT_NAME;
    const expectedPageName = clean(options.expectedPageName) || DEFAULT_EXPECTED_PAGE_NAME;
    const idOf = el => clean(el?.getAttribute?.(ATTR));

    const parseComponentId = id => {
      const value = clean(id);
      const match = value.match(/^(.*)-([^-]+)-([A-Za-z0-9]+)$/);
      if (!match || isCtaId(value)) return null;
      return {
        raw: value,
        pageName: match[1],
        componentName: match[2],
        componentHash: match[3]
      };
    };

    const parseCtaId = id => {
      const value = clean(id);
      const match = value.match(/^(.*)-([^-]+)-([A-Za-z0-9]+)-cta_([A-Za-z0-9]+)$/);
      if (!match) return null;
      return {
        raw: value,
        pageName: match[1],
        componentName: match[2],
        componentHash: match[3],
        ctaHash: match[4]
      };
    };

    const short = value => {
      const normalized = clean(value).replace(/\s+/g, ' ');
      return normalized.length > 100 ? `${normalized.slice(0, 97)}...` : normalized;
    };

    const cssPath = el => {
      const parts = [];
      let node = el;

      while (node && node.nodeType === 1 && parts.length < 6) {
        let part = node.tagName.toLowerCase();

        if (node.id) {
          part += `#${node.id}`;
          parts.unshift(part);
          break;
        }

        const classes = [...node.classList].slice(0, 2).join('.');
        if (classes) part += `.${classes}`;

        if (node.parentElement) {
          const siblings = [...node.parentElement.children].filter(
            child => child.tagName === node.tagName
          );
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
          }
        }

        parts.unshift(part);
        node = node.parentElement;
      }

      return parts.join(' > ');
    };

    const labelOf = el =>
      short(
        el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.value ||
          el.textContent
      );

    const wrapperSelector = [
      `[class~="${escapeCss(componentName)}"]`,
      `[data-cmp="${componentName}"]`,
      `[data-component="${componentName}"]`,
      `[data-component-name="${componentName}"]`,
      `[data-cmp-is="${componentName}"]`
    ].join(', ');

    const wrapperEls = [...document.querySelectorAll(wrapperSelector)].filter(
      el => !el.parentElement?.closest(wrapperSelector)
    );

    const componentElFromWrapper = wrapper => {
      if (wrapper.hasAttribute(ATTR) && !isCtaId(idOf(wrapper))) return wrapper;
      return [...wrapper.querySelectorAll(`[${ATTR}]`)].find(el => !isCtaId(idOf(el))) || null;
    };

    const allTargetEls = [...document.querySelectorAll(`[${ATTR}]`)];
    const componentElsFromIds = allTargetEls.filter(el => {
      const parsed = parseComponentId(idOf(el));
      return parsed && parsed.componentName === componentName;
    });

    const componentEls = [
      ...new Set([
        ...wrapperEls.map(componentElFromWrapper).filter(Boolean),
        ...componentElsFromIds
      ])
    ];

    const componentSet = new Set(componentEls);

    const ownerComponent = el => {
      let node = el;
      while (node) {
        if (componentSet.has(node)) return node;
        node = node.parentElement;
      }
      return null;
    };

    const hasOwnedCtaMarker = (node, owner) => {
      if (node.hasAttribute(ATTR) && isCtaId(idOf(node)) && ownerComponent(node) === owner) {
        return true;
      }

      return [...node.querySelectorAll(`[${ATTR}]`)].some(
        child => isCtaId(idOf(child)) && ownerComponent(child) === owner
      );
    };

    const report = {
      componentName,
      expectedPageName: expectedPageName || 'any',
      summary: {},
      acceptanceCriteria: [],
      wrappersFound: wrapperEls.length,
      componentNodesFound: componentEls.length,
      wrappersMissingTargetId: [],
      badComponentFormat: [],
      pageNameMismatch: [],
      wrongComponentName: [],
      componentMissingElementId: [],
      duplicates: [],
      badCtaFormat: [],
      ctaParentMismatch: [],
      interactiveMissingCta: [],
      emptyDataAttributes: [],
      suspiciousEmptyDivs: [],
      limitations: [
        'DOM-only audit. Authoring dialog fields cannot be verified here.',
        'Friendly-name precedence cannot be proven from DOM alone.',
        'Adobe Target VEC selectability still needs manual verification in Adobe Target.'
      ]
    };

    for (const wrapper of wrapperEls) {
      const componentEl = componentElFromWrapper(wrapper);
      if (!componentEl) {
        report.wrappersMissingTargetId.push({
          path: cssPath(wrapper),
          issue: `No ${ATTR} found on this ${componentName} component`
        });
      }
    }

    const selectedIds = [];
    for (const componentEl of componentEls) {
      const componentId = idOf(componentEl);
      selectedIds.push(componentId);

      const parsed = parseComponentId(componentId);
      if (!parsed) {
        report.badComponentFormat.push({
          targetId: componentId,
          path: cssPath(componentEl),
          expected: '<pageName>-<componentName>-<hash>'
        });
      } else {
        if (parsed.componentName !== componentName) {
          report.wrongComponentName.push({
            targetId: componentId,
            parsedComponentName: parsed.componentName,
            expectedComponentName: componentName,
            path: cssPath(componentEl)
          });
        }

        if (expectedPageName && parsed.pageName !== expectedPageName) {
          report.pageNameMismatch.push({
            targetId: componentId,
            actualPageName: parsed.pageName,
            expectedPageName,
            path: cssPath(componentEl)
          });
        }
      }

      const elementIdAttr = ELEMENT_ID_ATTRS.find(attr => clean(componentEl.getAttribute(attr)));
      if (!elementIdAttr) {
        report.componentMissingElementId.push({
          targetId: componentId,
          path: cssPath(componentEl),
          expected: 'id or data-element-id'
        });
      }

      const ctaEls = [...componentEl.querySelectorAll(`[${ATTR}]`)].filter(
        el => isCtaId(idOf(el)) && ownerComponent(el) === componentEl
      );

      for (const ctaEl of ctaEls) {
        const ctaId = idOf(ctaEl);
        selectedIds.push(ctaId);

        const parsedCta = parseCtaId(ctaId);
        if (!parsedCta) {
          report.badCtaFormat.push({
            ctaId,
            path: cssPath(ctaEl),
            expected: '<pageName>-<componentName>-<componentHash>-cta_<ctaHash>'
          });
        } else {
          if (parsedCta.componentName !== componentName) {
            report.wrongComponentName.push({
              targetId: ctaId,
              parsedComponentName: parsedCta.componentName,
              expectedComponentName: componentName,
              path: cssPath(ctaEl)
            });
          }

          if (expectedPageName && parsedCta.pageName !== expectedPageName) {
            report.pageNameMismatch.push({
              targetId: ctaId,
              actualPageName: parsedCta.pageName,
              expectedPageName,
              path: cssPath(ctaEl)
            });
          }
        }

        if (!ctaId.startsWith(`${componentId}-cta_`)) {
          report.ctaParentMismatch.push({
            ctaId,
            componentId,
            expectedPrefix: `${componentId}-cta_`,
            path: cssPath(ctaEl)
          });
        }
      }

      const interactiveEls = [...componentEl.querySelectorAll(INTERACTIVE)].filter(
        el => ownerComponent(el) === componentEl
      );

      for (const el of interactiveEls) {
        if (!hasOwnedCtaMarker(el, componentEl)) {
          report.interactiveMissingCta.push({
            componentId,
            tag: el.tagName.toLowerCase(),
            label: labelOf(el),
            path: cssPath(el)
          });
        }
      }

      for (const el of componentEl.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
          if (attr.name.startsWith('data-') && !clean(attr.value)) {
            report.emptyDataAttributes.push({
              componentId,
              attribute: attr.name,
              path: cssPath(el)
            });
          }
        }
      }

      for (const div of componentEl.querySelectorAll('div')) {
        const style = getComputedStyle(div);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (div.children.length > 0) continue;
        if (clean(div.textContent)) continue;
        if (div.hasAttribute(ATTR)) continue;
        if (div.id) continue;
        if (div.getAttribute('role')) continue;

        const meaningfulAttrs = [...div.attributes].some(attr => {
          const name = attr.name;
          if (name === 'class' || name === 'style') return false;
          return name.startsWith('aria-') || name.startsWith('data-') || name === 'title';
        });

        if (meaningfulAttrs) continue;

        report.suspiciousEmptyDivs.push({
          componentId,
          path: cssPath(div)
        });
      }
    }

    const countMap = {};
    for (const id of selectedIds) {
      countMap[id] = (countMap[id] || 0) + 1;
    }

    for (const [id, count] of Object.entries(countMap)) {
      if (count > 1) {
        report.duplicates.push({ id, count });
      }
    }

    report.summary = {
      componentName,
      wrappersFound: wrapperEls.length,
      componentNodesFound: componentEls.length,
      wrappersMissingTargetId: report.wrappersMissingTargetId.length,
      duplicateIds: report.duplicates.length,
      badComponentFormat: report.badComponentFormat.length,
      wrongComponentName: report.wrongComponentName.length,
      pageNameMismatch: report.pageNameMismatch.length,
      componentMissingElementId: report.componentMissingElementId.length,
      badCtaFormat: report.badCtaFormat.length,
      ctaParentMismatch: report.ctaParentMismatch.length,
      interactiveMissingCta: report.interactiveMissingCta.length,
      emptyDataAttributes: report.emptyDataAttributes.length,
      suspiciousEmptyDivs: report.suspiciousEmptyDivs.length
    };

    report.acceptanceCriteria = [
      {
        id: 'AC1',
        criterion: 'Component ID field exists in authoring',
        status: 'MANUAL',
        details: 'Cannot be verified from DOM'
      },
      {
        id: 'AC2',
        criterion: `${ATTR} is populated in HTML for ${componentName}`,
        status:
          report.wrappersMissingTargetId.length === 0 && componentEls.length > 0
            ? 'PASS'
            : componentEls.length > 0
              ? 'PARTIAL'
              : 'FAIL',
        details:
          report.wrappersMissingTargetId.length === 0 && componentEls.length > 0
            ? `Found ${componentEls.length} ${componentName} component nodes with ${ATTR}`
            : componentEls.length > 0
              ? `Found ${componentEls.length} ${componentName} component nodes, but ${report.wrappersMissingTargetId.length} wrappers have no target marker`
              : `No ${componentName} component with ${ATTR} found`
      },
      {
        id: 'AC3',
        criterion: 'Component ID format is <pageName>-<componentName>-<hash>',
        status:
          report.badComponentFormat.length === 0 &&
          report.wrongComponentName.length === 0 &&
          report.pageNameMismatch.length === 0
            ? 'PASS'
            : 'FAIL',
        details:
          report.badComponentFormat.length === 0 &&
          report.wrongComponentName.length === 0 &&
          report.pageNameMismatch.length === 0
            ? 'All component IDs match the expected format'
            : `bad format: ${report.badComponentFormat.length}, wrong component name: ${report.wrongComponentName.length}, page mismatch: ${report.pageNameMismatch.length}`
      },
      {
        id: 'AC4',
        criterion: 'CTA IDs are <pageName>-<componentName>-<componentHash>-cta_<ctaHash>',
        status:
          report.badCtaFormat.length === 0 &&
          report.ctaParentMismatch.length === 0 &&
          report.interactiveMissingCta.length === 0
            ? 'PASS'
            : 'FAIL',
        details:
          report.badCtaFormat.length === 0 &&
          report.ctaParentMismatch.length === 0 &&
          report.interactiveMissingCta.length === 0
            ? 'All detected CTAs are valid'
            : `bad CTA format: ${report.badCtaFormat.length}, parent mismatch: ${report.ctaParentMismatch.length}, interactive without CTA marker: ${report.interactiveMissingCta.length}`
      },
      {
        id: 'AC5',
        criterion: 'Component ID and Element ID are available in HTML',
        status: report.componentMissingElementId.length === 0 ? 'PASS' : 'FAIL',
        details:
          report.componentMissingElementId.length === 0
            ? 'All component nodes include id or data-element-id'
            : `Missing element id on ${report.componentMissingElementId.length} components`
      },
      {
        id: 'AC6',
        criterion: 'Friendly name takes precedence over generated name',
        status: 'MANUAL',
        details: 'Cannot be proven from DOM alone'
      },
      {
        id: 'AC7',
        criterion: 'No extra or unused div elements are present',
        status: report.suspiciousEmptyDivs.length === 0 ? 'PASS' : 'REVIEW',
        details:
          report.suspiciousEmptyDivs.length === 0
            ? 'No suspicious empty divs found'
            : `Suspicious empty divs found: ${report.suspiciousEmptyDivs.length}`
      },
      {
        id: 'AC8',
        criterion: 'Only authored fields with values are rendered in HTML',
        status: report.emptyDataAttributes.length === 0 ? 'PASS' : 'REVIEW',
        details:
          report.emptyDataAttributes.length === 0
            ? 'No empty data-* attributes found'
            : `Empty data-* attributes found: ${report.emptyDataAttributes.length}`
      },
      {
        id: 'AC9',
        criterion: 'Selector is visible/selectable for Adobe Target VEC',
        status: componentEls.length > 0 ? 'PARTIAL' : 'FAIL',
        details:
          componentEls.length > 0
            ? `${ATTR} exists for ${componentName}; verify actual selection in Adobe Target VEC manually`
            : `No ${componentName} ${ATTR} found`
      },
      {
        id: 'AC10',
        criterion: 'Component IDs are unique',
        status: report.duplicates.length === 0 ? 'PASS' : 'FAIL',
        details:
          report.duplicates.length === 0
            ? 'No duplicate IDs found for this component'
            : `Duplicate IDs found: ${report.duplicates.length}`
      }
    ];

    const show = (title, rows) => {
      if (!rows.length) return;
      console.group(title);
      console.table(rows);
      console.groupEnd();
    };

    console.group(`Target DOM Audit: ${componentName}`);
    console.table([report.summary]);
    console.group('Acceptance Criteria');
    console.table(report.acceptanceCriteria);
    console.groupEnd();

    show('Wrappers missing data-target-id', report.wrappersMissingTargetId);
    show('Bad component format', report.badComponentFormat);
    show('Wrong component name', report.wrongComponentName);
    show('Page name mismatch', report.pageNameMismatch);
    show('Components missing element id', report.componentMissingElementId);
    show('Duplicate ids', report.duplicates);
    show('Bad CTA format', report.badCtaFormat);
    show('CTA parent mismatch', report.ctaParentMismatch);
    show('Interactive elements missing CTA', report.interactiveMissingCta);
    show('Empty data-* attributes', report.emptyDataAttributes);
    show('Suspicious empty divs', report.suspiciousEmptyDivs);

    console.log('Limitations:', report.limitations);
    console.log('Full report saved to __targetAudit in the current execution context');
    console.groupEnd();

    globalThis.__targetAudit = report;
    return report;
  }

  globalThis.runTargetDomAudit = runTargetDomAudit;

  const isExtensionContext =
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.id === 'string' &&
    chrome.runtime.onMessage;

  if (isExtensionContext) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== MESSAGE_TYPE) {
        return undefined;
      }

      try {
        const report = runTargetDomAudit({
          componentName: message.componentName,
          expectedPageName: message.expectedPageName
        });
        sendResponse({ ok: true, report });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      return true;
    });

    return;
  }

  runTargetDomAudit({
    componentName: DEFAULT_COMPONENT_NAME,
    expectedPageName: DEFAULT_EXPECTED_PAGE_NAME
  });
})();
