/* Copyright (c) 2012 Joshfire - MIT license */
/**
 * @fileoverview Core of the JSON Form client-side library.
 *
 * Generates an HTML form from a structured data model and a layout description.
 *
 * The library may also validate inputs entered by the user against the data model
 * upon form submission and create the structured data object initialized with the
 * values that were submitted.
 *
 * The library depends on:
 *  - jQuery
 *  - the underscore library
 *  - a JSON parser/serializer. Nothing to worry about in modern browsers.
 *  - the JSONFormValidation library (in jsv.js) for validation purpose
 *
 * See documentation at:
 * http://developer.joshfire.com/doc/dev/ref/jsonform
 *
 * The library creates and maintains an internal data tree along with the DOM.
 * That structure is necessary to handle arrays (and nested arrays!) that are
 * dynamic by essence.
 */

(function ($, _) {
  /**
   * Regular expressions used to extract array indexes in input field names
   */
  var reArray = /\[([0-9]*)\](?=\[|\.|$)/g;

  /**
   * Template settings for form views
   */
  var fieldTemplateSettings = {
    evaluate: /<%([\s\S]+?)%>/g,
    interpolate: /<%=([\s\S]+?)%>/g
  };

  /**
   * Template settings for value replacement
   */
  var valueTemplateSettings = {
    evaluate: /\{\[([\s\S]+?)\]\}/g,
    interpolate: /\{\{([\s\S]+?)\}\}/g
  };

  const defaults = (target, ...sources) => {
    sources.forEach(source => {
      Object.keys(source).forEach(key => {
        if (target[key] === undefined) {
          target[key] = source[key];
        }
      });
    });
    return target;
  };

  const clone = (value) => {
    if (Array.isArray(value)) {
      return [...value];
    }
    return Object.assign({}, value);
  };

  const escape = (str) => {
    try {return str.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');} 
    catch (error)
    {
      console.error('error:', error.message)
    }
    
  };

  (function() {
    var _ = {};

    this.templateSettings = {
        evaluate: /<%([\s\S]+?)%>/g,
        interpolate: /<%=([\s\S]+?)%>/g
    };
    
    var noMatch = /(.)^/;
    
    var escapes = {
        "'": "'",
        '\\': '\\',
        '\r': 'r',
        '\n': 'n',
        '\u2028': 'u2028',
        '\u2029': 'u2029'
    };
    
    var escapeRegExp = /\\|'|\r|\n|\u2028|\u2029/g;
    
    var escapeChar = function(match) {
        return '\\' + escapes[match];
    };
    
    this.tmpl = function(text, settings) {
    
        settings = Object.assign({}, this.templateSettings, settings);
    
        var matcher = RegExp([
            (settings.escape || noMatch).source,
            (settings.interpolate || noMatch).source,
            (settings.evaluate || noMatch).source
        ].join('|') + '|$', 'g');
    
        var index = 0;
        var source = "__p+='";
        text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
    
            source += text.slice(index, offset).replace(escapeRegExp, escapeChar);
    
            index = offset + match.length;
    
            if (escape) {
                source += "'+\n((__t=(" + escape + "))==null?'':escape(__t))+\n'";
            } else if (interpolate) {
                source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
            } else if (evaluate) {
                source += "';\n" + evaluate + "\n__p+='";
            }
    
            return match;
        });
        source += "';\n";
    
        if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';
    
        source = "var __t,__p='',__j=Array.prototype.join," +
            "print=function(){__p+=__j.call(arguments,'');};\n" +
            source + 'return __p;\n';
    
        var render;
        try {
            render = new Function(settings.variable || 'obj', '_', source);
        } catch (e) {
            e.source = source;
            throw e;
        }
    
        var template = function(data) {
            return render.call(this, data, _);
        };
    
        var argument = settings.variable || 'obj';
        template.source = 'function(' + argument + '){\n' + source + '}';
    
        return template;
    };
})();
  
  /**
   * Returns true if given value is neither "undefined" nor null
   */
  var isSet = function (value) {
    return !(value === undefined || value === null);
  };

  /**
   * Returns true if given property is directly property of an object
   */
  var hasOwnProperty = function (obj, prop) {
    return typeof obj === 'object' && obj.hasOwnProperty(prop);
  }

  /**
   * The jsonform object whose methods will be exposed to the window object
   */
  var jsonform = { util: {} };


  // From backbonejs
  var escapeHTML = function (string) {
    if (!isSet(string)) {
      return '';
    }
    string = '' + string;
    if (!string) {
      return '';
    }
    return string
      .replace(/&(?!\w+;|#\d+;|#x[\da-f]+;)/gi, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  };

  /**
   * Escapes selector name for use with jQuery
   *
   * All meta-characters listed in jQuery doc are escaped:
   * http://api.jquery.com/category/selectors/
   *
   * @function
   * @param {String} selector The jQuery selector to escape
   * @return {String} The escaped selector.
   */
  var escapeSelector = function (selector) {
    return selector.replace(/([ \!\"\#\$\%\&\'\(\)\*\+\,\.\/\:\;<\=\>\?\@\[\\\]\^\`\{\|\}\~])/g, '\\$1');
  };

  /**
   *
   * Slugifies a string by replacing spaces with _ Used to create
   * valid classnames and ids for the form.
   *
   * @function
   * @param {String} str The string to slugify
   * @return {String} The slugified string.
   */
  var slugify = function (str) {
    return str.replace(/\ /g, '_');
  }

  /**
   * Initializes tabular sections in forms. Such sections are generated by the
   * 'selectfieldset' type of elements in JSON Form.
   *
   * Input fields that are not visible are automatically disabled
   * not to appear in the submitted form. That's on purpose, as tabs
   * are meant to convey an alternative (and not a sequence of steps).
   *
   * The tabs menu is not rendered as tabs but rather as a select field because
   * it's easier to grasp that it's an alternative.
   *
   * Code based on bootstrap-tabs.js, updated to:
   * - react to option selection instead of tab click
   * - disable input fields in non visible tabs
   * - disable the possibility to have dropdown menus (no meaning here)
   * - act as a regular function instead of as a jQuery plug-in.
   *
   * @function
   * @param {Object} tabs jQuery object that contains the tabular sections
   *  to initialize. The object may reference more than one element.
   */
  var initializeTabs = function (tabs) {
    var activate = function (element, container) {
      container
        .find('> .active')
        .removeClass('active');
      element.addClass('active');
    };

    var enableFields = function ($target, targetIndex) {
      // Enable all fields in the targeted tab
      $target.find('input, textarea, select').removeAttr('disabled');

      // Disable all fields in other tabs
      $target.parent()
        .children(':not([data-idx=' + targetIndex + '])')
        .find('input, textarea, select')
        .attr('disabled', 'disabled');
    };

    var optionSelected = function (e) {
      var $option = $("option:selected", $(this)),
        $select = $(this),
        // do not use .attr() as it sometimes unexplicably fails
        targetIdx = $option.get(0).getAttribute('data-idx') || $option.attr('value'),
        $target;

      e.preventDefault();
      if ($option.hasClass('active')) {
        return;
      }

      $target = $(this).parents('.tabbable').eq(0).find('> .tab-content > [data-idx=' + targetIdx + ']');

      activate($option, $select);
      activate($target, $target.parent());
      enableFields($target, targetIdx);
    };

    var tabClicked = function (e) {
      var $a = $('a', $(this));
      var $content = $(this).parents('.tabbable').first()
        .find('.tab-content').first();
      var targetIdx = $(this).index();
      // The `>` here is to prevent activating selectfieldsets inside a tabarray
      var $target = $content.find('> [data-idx=' + targetIdx + ']');

      e.preventDefault();
      activate($(this), $(this).parent());
      activate($target, $target.parent());
      if ($(this).parent().hasClass('jsonform-alternative')) {
        enableFields($target, targetIdx);
      }
    };

    tabs.each(function () {
      $(this).delegate('select.nav', 'change', optionSelected);
      $(this).find('select.nav').each(function () {
        $(this).val($(this).find('.active').attr('value'));
        // do not use .attr() as it sometimes unexplicably fails
        var targetIdx = $(this).find('option:selected').get(0).getAttribute('data-idx') ||
          $(this).find('option:selected').attr('value');
        var $target = $(this).parents('.tabbable').eq(0).find('> .tab-content > [data-idx=' + targetIdx + ']');
        enableFields($target, targetIdx);
      });

      $(this).delegate('ul.nav li', 'click', tabClicked);
      $(this).find('ul.nav li.active').click();
    });
  };

  // Twitter bootstrap-friendly HTML boilerplate for standard inputs
  jsonform.fieldTemplate = (inner, elt, node) => {
    const metaData = elt && elt.htmlMetaData ? elt.htmlMetaData : {};
    const metaDataAttrs = Object.keys(metaData).map(key => `${key}="${metaData[key]}"`).join(' ');
    const classList = `pure-control-group ${node.schemaElement && node.schemaElement.required && (node.schemaElement.type !== "boolean") ? "jsonform-required" : ""} ${node.readOnly ? "jsonform-readonly" : ""} ${node.disabled ? "jsonform-disabled" : ""}`;
    const label = node.title ? node.title : node.name;
    const description = node.description ? `<span class="help-block">${node.description}</span>` : '';
  
    return `<div ${metaDataAttrs} class="${classList}">
      ${elt && elt.notitle ? '' : `<label for="${node.id}">${label}</label>`}
      ${inner}
      ${description}
      <span class="help-block jsonform-errortext" style="display:none;"></span>
    </div>`;
  };

  var inputFieldTemplate = function (type) {
    return {
      template:  (data) => `<input type="${type}" name="${data.node.name}" value="${escape(data.value)}" id="${data.id}" ${data.node.disabled ? " disabled" : ""} ${data.node.readOnly ? " readonly='readonly'" : ""} ${data.node.schemaElement && (data.node.schemaElement.step > 0 || data.node.schemaElement.step == "any") ? " step='" + data.node.schemaElement.step + "'" : ""} ${data.node.schemaElement && data.node.schemaElement.minLength ? " minlength='" + data.node.schemaElement.minLength + "'" : ""} ${data.node.schemaElement && data.node.schemaElement.maxLength ? " maxlength='" + data.node.schemaElement.maxLength + "'" : ""} ${data.node.schemaElement && data.node.schemaElement.required && (data.node.schemaElement.type !== "boolean") ? " required='required'" : ""} ${data.node.placeholder ? " placeholder='" + escape(data.node.placeholder) + "'" : ""} />`,
      'childTemplate': function (inner) {
        return '<div class="pure-control-group">' +
          inner +
          '</div>';
      }
    }
  };

  jsonform.elementTypes = {
    'none': {
      'template': ''
    },
    'root': {
      template: (data) => `<div class="pure-form pure-form-aligned">${data.children}</div>`
    },
    'text': inputFieldTemplate('text'),
    'password': inputFieldTemplate('password'),
    'date': inputFieldTemplate('date'),
    'datetime': inputFieldTemplate('datetime'),
    'datetime-local': inputFieldTemplate('datetime-local'),
    'email': inputFieldTemplate('email'),
    'month': inputFieldTemplate('month'),
    'number': inputFieldTemplate('number'),
    'search': inputFieldTemplate('search'),
    'tel': inputFieldTemplate('tel'),
    'time': inputFieldTemplate('time'),
    'url': inputFieldTemplate('url'),
    'week': inputFieldTemplate('week'),
    'range': {
      template : (data) => {
        const classAttribute = data.fieldHtmlClass ? `class="${data.fieldHtmlClass}" ` : '';
        const disabledAttribute = data.node.disabled ? ' disabled' : '';
        const requiredAttribute = data.node.schemaElement && data.node.schemaElement.required ? ' required="required"' : '';
        const ariaLabel = data.node.title ? escape(data.node.title) : data.node.name;
        const indicator = data.range.indicator ? `<span class="range-value" rel="${data.id}">${escape(data.value)}</span>` : '';
      
        return `<div class="range"><input type="range" ${classAttribute}
          name="${data.node.name}" value="${escape(data.value)}" id="${data.id}"
          aria-label="${ariaLabel}" ${disabledAttribute} min="${data.range.min}"
          max="${data.range.max}" step="${data.range.step}" ${requiredAttribute} />
          ${indicator}
        </div>`;
      },
      'onInput': function (evt, elt) {
        const valueIndicator = document.querySelector('span.range-value[rel="' + elt.id + '"]');
        if (valueIndicator) {
          valueIndicator.innerText = evt.target.value;
        }
      },
      'onBeforeRender': function (data, node) {
        data.range = {
          min: 1,
          max: 100,
          step: 1,
          indicator: false
        };
        if (!node || !node.schemaElement) return;
        if (node.formElement && node.formElement.step) {
          data.range.step = node.formElement.step;
        }
        if (node.formElement && node.formElement.indicator) {
          data.range.indicator = node.formElement.indicator;
        }
        if (typeof node.schemaElement.minimum !== 'undefined') {
          if (node.schemaElement.exclusiveMinimum) {
            data.range.min = node.schemaElement.minimum + data.range.step;
          }
          else {
            data.range.min = node.schemaElement.minimum;
          }
        }
        if (typeof node.schemaElement.maximum !== 'undefined') {
          if (node.schemaElement.exclusiveMaximum) {
            data.range.max = node.schemaElement.maximum - data.range.step;
          }
          else {
            data.range.max = node.schemaElement.maximum;
          }
        }
      }
    },
    'color': { /* not supported any more */
      'template': '<input type="text" ' +
        '<%= (fieldHtmlClass ? "class=\'" + fieldHtmlClass + "\' " : "") %>' +
        'name="<%= node.name %>" value="<%= escape(value) %>" id="<%= id %>"' +
        ' aria-label="<%= node.title ? escape(node.title) : node.name %>"' +
        '<%= (node.disabled? " disabled" : "")%>' +
        '<%= (node.schemaElement && node.schemaElement.required ? " required=\'required\'" : "") %>' +
        ' />',
      'onInsert': function (evt, node) {
        $(node.el).find('#' + escapeSelector(node.id)).spectrum({
          preferredFormat: "hex",
          showInput: true
        });
      }
    },
    'checkbox': {
      template : (data) => `<div class="checkbox"><label class="toggle-switch"><input type="checkbox" id="${data.id}" name="${data.node.name}" value="1" ${data.value ? 'checked' : ''} ${data.node.disabled ? 'disabled' : ''} ${data.node.schemaElement && data.node.schemaElement.required && (data.node.schemaElement.type !== "boolean") ? 'required="required"' : ''} /> ${data.node.inlinetitle || ""}<div class="slider"></div></label></div>`,
      'getElement': function (el) {
        return $(el).parent().get(0);
      }
    },
    'file': {
      'template': '<input class="input-file" id="<%= id %>" name="<%= node.name %>" type="file" ' +
        '<%= (node.schemaElement && node.schemaElement.required ? " required=\'required\'" : "") %>' +
        '<%= (node.formElement && node.formElement.accept ? (" accept=\'" + node.formElement.accept + "\'") : "") %>' +
        '/>',
    },
    'select': {
      template : (data) => `<select name="${data.node.name}" id="${data.id}" ${data.node.schemaElement && data.node.schemaElement.disabled ? " disabled" : ""} ${data.node.schemaElement && data.node.schemaElement.required ? " required='required'" : ""}>
  ${data.node.options.map((key, val) => {
    if (key instanceof Object) {
      return data.value === key.value
        ? `<option selected value="${key.value}">${key.title}</option>`
        : `<option value="${key.value}">${key.title}</option>`;
    } else {
      return data.value === key
        ? `<option selected value="${key}">${key}</option>`
        : `<option value="${key}">${key}</option>`;
    }
  }).join(' ')}
</select>`
    },
    'radiobuttons': {
      'template': '<div id="<%= node.id %>">' +
        '<% node.options.forEach((key, val)=>{ %>' +
        '<label class="btn btn-default <% if (((key instanceof Object) && (value === key.value)) || (value === key)) { %>active btn-success<% } %>">' +
        '<input<%= (fieldHtmlClass ? " class=\'" + fieldHtmlClass + "\'": "") %> type="radio" style="position:absolute;left:-9999px;" ' +
        '<% if (((key instanceof Object) && (value === key.value)) || (value === key)) { %> checked="checked" <% } %> name="<%= node.name %>" value="<%= (key instanceof Object ? key.value : key) %>" />' +
        '<span><%= (key instanceof Object ? key.title : key) %></span></label> ' +
        '<% }); %>' +
        '</div>',
      'onInsert': function (evt, node) {
        var activeClass = 'active';
        var elt = node.formElement || {};
        if (elt.activeClass) {
          activeClass += ' ' + elt.activeClass;
        }
        $(node.el).find('label').on('click', function () {
          $(this).parent().find('label').removeClass(activeClass);
          $(this).addClass(activeClass);
        });
      }
    },
    'checkboxes': {
      'template': '<div><%= choiceshtml %></div>',
      'onBeforeRender': function (data, node) {
        // Build up choices from the enumeration list
        var choices = null;
        var choiceshtml = null;
        var template = '<div class="checkbox"><label>' +
          '<input type="checkbox" <% if (value) { %> checked="checked" <% } %> name="<%= name %>" value="1"' +
          '<%= (node.disabled? " disabled" : "")%>' +
          '/><%= title %></label></div>';
        if (!node || !node.schemaElement) return;

        if (node.schemaElement.items) {
          choices =
            node.schemaElement.items["enum"] ||
            node.schemaElement.items[0]["enum"];
        } else {
          choices = node.schemaElement["enum"];
        }
        if (!choices) return;

        choiceshtml = '';
        choices.forEach((choice, idx) => {
          choiceshtml += tmpl(template, fieldTemplateSettings)({
            name: node.key + '[' + idx + ']',
            value: node.value.includes(choice),
            title: hasOwnProperty(node.formElement.titleMap, choice) ? node.formElement.titleMap[choice] : choice,
            node: node
          });
        });

        data.choiceshtml = choiceshtml;
      }
    },
    'array': {
      'template': '<div id="<%= id %>"><ul class="_jsonform-array-ul" style="list-style-type:none;"><%= children %></ul>' +
        '<span class="_jsonform-array-buttons">' +
        '<a href="#" class="btn btn-default _jsonform-array-addmore"><i class="glyphicon glyphicon-plus-sign" title="Add new"></i></a> ' +
        '<a href="#" class="btn btn-default _jsonform-array-deletelast"><i class="glyphicon glyphicon-minus-sign" title="Delete last"></i></a>' +
        '</span>' +
        '</div>',
      'array': true,
      'childTemplate': function (inner, enableDrag) {
        if ($('').sortable) {
          // Insert a "draggable" icon
          // floating to the left of the main element
          return '<li data-idx="<%= node.childPos %>">' +
            // only allow drag of children if enabled
            (enableDrag ? '<span class="draggable line"><i class="glyphicon glyphicon-list" title="Move item"></i></span>' : '') +
            inner +
            '</li>';
        }
        else {
          return '<li data-idx="<%= node.childPos %>">' +
            inner +
            '</li>';
        }
      },
      'onInsert': function (evt, node) {
        var $nodeid = $(node.el).find('#' + escapeSelector(node.id));
        var boundaries = node.getArrayBoundaries();

        // Switch two nodes in an array
        var moveNodeTo = function (fromIdx, toIdx) {
          // Note "switchValuesWith" extracts values from the DOM since field
          // values are not synchronized with the tree data structure, so calls
          // to render are needed at each step to force values down to the DOM
          // before next move.
          // TODO: synchronize field values and data structure completely and
          // call render only once to improve efficiency.
          if (fromIdx === toIdx) return;
          var incr = (fromIdx < toIdx) ? 1 : -1;
          var i = 0;
          var parentEl = $('> ul', $nodeid);
          for (i = fromIdx; i !== toIdx; i += incr) {
            node.children[i].switchValuesWith(node.children[i + incr]);
            node.children[i].render(parentEl.get(0));
            node.children[i + incr].render(parentEl.get(0));
          }

          // No simple way to prevent DOM reordering with jQuery UI Sortable,
          // so we're going to need to move sorted DOM elements back to their
          // origin position in the DOM ourselves (we switched values but not
          // DOM elements)
          var fromEl = $(node.children[fromIdx].el);
          var toEl = $(node.children[toIdx].el);
          fromEl.detach();
          toEl.detach();
          if (fromIdx < toIdx) {
            if (fromIdx === 0) parentEl.prepend(fromEl);
            else $(node.children[fromIdx - 1].el).after(fromEl);
            $(node.children[toIdx - 1].el).after(toEl);
          }
          else {
            if (toIdx === 0) parentEl.prepend(toEl);
            else $(node.children[toIdx - 1].el).after(toEl);
            $(node.children[fromIdx - 1].el).after(fromEl);
          }
        };

        $('> span > a._jsonform-array-addmore', $nodeid).click(function (evt) {
          evt.preventDefault();
          evt.stopPropagation();
          var idx = node.children.length;
          if (boundaries.maxItems >= 0) {
            if (node.children.length > boundaries.maxItems - 2) {
              $nodeid.find('> span > a._jsonform-array-addmore')
                .addClass('disabled');
            }
            if (node.children.length > boundaries.maxItems - 1) {
              return false;
            }
          }
          node.insertArrayItem(idx, $('> ul', $nodeid).get(0));
          if ((boundaries.minItems <= 0) ||
            ((boundaries.minItems > 0) &&
              (node.children.length > boundaries.minItems - 1))) {
            $nodeid.find('> span > a._jsonform-array-deletelast')
              .removeClass('disabled');
          }
        });

        //Simulate Users click to setup the form with its minItems
        var curItems = $('> ul > li', $nodeid).length;
        if ((boundaries.minItems > 0) &&
          (curItems < boundaries.minItems)) {
          for (var i = 0; i < (boundaries.minItems - 1) && ($nodeid.find('> ul > li').length < boundaries.minItems); i++) {
            node.insertArrayItem(curItems, $nodeid.find('> ul').get(0));
          }
        }
        if ((boundaries.minItems > 0) &&
          (node.children.length <= boundaries.minItems)) {
          $nodeid.find('> span > a._jsonform-array-deletelast')
            .addClass('disabled');
        }

        $('> span > a._jsonform-array-deletelast', $nodeid).click(function (evt) {
          var idx = node.children.length - 1;
          evt.preventDefault();
          evt.stopPropagation();
          if (boundaries.minItems > 0) {
            if (node.children.length < boundaries.minItems + 2) {
              $nodeid.find('> span > a._jsonform-array-deletelast')
                .addClass('disabled');
            }
            if (node.children.length <= boundaries.minItems) {
              return false;
            }
          }
          else if (node.children.length === 1) {
            $nodeid.find('> span > a._jsonform-array-deletelast')
              .addClass('disabled');
          }
          node.deleteArrayItem(idx);
          if ((boundaries.maxItems >= 0) && (idx <= boundaries.maxItems - 1)) {
            $nodeid.find('> span > a._jsonform-array-addmore')
              .removeClass('disabled');
          }
        });

        // only allow drag if default or enabled
        if (!isSet(node.formElement.draggable) || node.formElement.draggable) {
          if ($(node.el).sortable) {
            $('> ul', $nodeid).sortable();
            $('> ul', $nodeid).bind('sortstop', function (event, ui) {
              var idx = $(ui.item).data('idx');
              var newIdx = $(ui.item).index();
              moveNodeTo(idx, newIdx);
            });
          }
        }
      }
    },
    'tabarray': {
      'template': '<div id="<%= id %>"><div class="tabbable tabs-left">' +
        '<ul class="nav nav-tabs">' +
        '<%= tabs %>' +
        '</ul>' +
        '<div class="tab-content">' +
        '<%= children %>' +
        '</div>' +
        '</div>' +
        '<a href="#" class="btn btn-default _jsonform-array-addmore"><i class="glyphicon glyphicon-plus-sign" title="Add new"></i></a> ' +
        '<a href="#" class="btn btn-default _jsonform-array-deleteitem"><i class="glyphicon glyphicon-minus-sign" title="Delete item"></i></a></div>',
      'array': true,
      'childTemplate': function (inner) {
        return '<div data-idx="<%= node.childPos %>" class="tab-pane">' +
          inner +
          '</div>';
      },
      'onBeforeRender': function (data, node) {
        // Generate the initial 'tabs' from the children
        var tabs = '';
        node.children.forEach((child, idx) => {
          var title = child.legend ||
            child.title ||
            ('Item ' + (idx + 1));
          tabs += '<li data-idx="' + idx + '"' +
            ((idx === 0) ? ' class="active"' : '') +
            '><a class="draggable tab" data-toggle="tab" rel="' + escape(title) + '">' +
            escapeHTML(title) +
            '</a></li>';
        });
        data.tabs = tabs;
      },
      'onInsert': function (evt, node) {
        var $nodeid = $(node.el).find('#' + escapeSelector(node.id));
        var boundaries = node.getArrayBoundaries();

        var moveNodeTo = function (fromIdx, toIdx) {
          // Note "switchValuesWith" extracts values from the DOM since field
          // values are not synchronized with the tree data structure, so calls
          // to render are needed at each step to force values down to the DOM
          // before next move.
          // TODO: synchronize field values and data structure completely and
          // call render only once to improve efficiency.
          if (fromIdx === toIdx) return;
          var incr = (fromIdx < toIdx) ? 1 : -1;
          var i = 0;
          var tabEl = $('> .tabbable > .tab-content', $nodeid).get(0);
          for (i = fromIdx; i !== toIdx; i += incr) {
            node.children[i].switchValuesWith(node.children[i + incr]);
            node.children[i].render(tabEl);
            node.children[i + incr].render(tabEl);
          }
        };


        // Refreshes the list of tabs
        var updateTabs = function (selIdx) {
          var tabs = '';
          var activateFirstTab = false;
          if (selIdx === undefined) {
            selIdx = $('> .tabbable > .nav-tabs .active', $nodeid).data('idx');
            if (selIdx) {
              selIdx = parseInt(selIdx, 10);
            }
            else {
              activateFirstTab = true;
              selIdx = 0;
            }
          }
          if (selIdx >= node.children.length) {
            selIdx = node.children.length - 1;
          }
          node.children.forEach((child, idx) => {
            $('> .tabbable > .tab-content > [data-idx="' + idx + '"] > fieldset > legend', $nodeid).html(child.legend);
            var title = child.legend || child.title || ('Item ' + (idx + 1));
            tabs += '<li data-idx="' + idx + '">' +
              '<a class="draggable tab" data-toggle="tab" rel="' + escape(title) + '">' +
              escapeHTML(title) +
              '</a></li>';
          });
          $('> .tabbable > .nav-tabs', $nodeid).html(tabs);
          if (activateFirstTab) {
            $('> .tabbable > .nav-tabs [data-idx="0"]', $nodeid).addClass('active');
          }
          $('> .tabbable > .nav-tabs [data-toggle="tab"]', $nodeid).eq(selIdx).click();
        };

        $('> a._jsonform-array-deleteitem', $nodeid).click(function (evt) {
          var idx = $('> .tabbable > .nav-tabs .active', $nodeid).data('idx');
          evt.preventDefault();
          evt.stopPropagation();
          if (boundaries.minItems > 0) {
            if (node.children.length < boundaries.minItems + 1) {
              $nodeid.find('> a._jsonform-array-deleteitem')
                .addClass('disabled');
            }
            if (node.children.length <= boundaries.minItems) return false;
          }
          node.deleteArrayItem(idx);
          updateTabs();
          if ((node.children.length < boundaries.minItems + 1) ||
            (node.children.length === 0)) {
            $nodeid.find('> a._jsonform-array-deleteitem').addClass('disabled');
          }
          if ((boundaries.maxItems >= 0) &&
            (node.children.length <= boundaries.maxItems)) {
            $nodeid.find('> a._jsonform-array-addmore').removeClass('disabled');
          }
        });

        $('> a._jsonform-array-addmore', $nodeid).click(function (evt) {
          var idx = node.children.length;
          if (boundaries.maxItems >= 0) {
            if (node.children.length > boundaries.maxItems - 2) {
              $('> a._jsonform-array-addmore', $nodeid).addClass("disabled");
            }
            if (node.children.length > boundaries.maxItems - 1) {
              return false;
            }
          }
          evt.preventDefault();
          evt.stopPropagation();
          node.insertArrayItem(idx,
            $nodeid.find('> .tabbable > .tab-content').get(0));
          updateTabs(idx);
          if ((boundaries.minItems <= 0) ||
            ((boundaries.minItems > 0) && (idx > boundaries.minItems - 1))) {
            $nodeid.find('> a._jsonform-array-deleteitem').removeClass('disabled');
          }
        });

        $(node.el).on('legendUpdated', function (evt) {
          updateTabs();
          evt.preventDefault();
          evt.stopPropagation();
        });

        // only allow drag if default or enabled
        if (!isSet(node.formElement.draggable) || node.formElement.draggable) {
          if ($(node.el).sortable) {
            $('> .tabbable > .nav-tabs', $nodeid).sortable({
              containment: node.el,
              tolerance: 'pointer'
            });
            $('> .tabbable > .nav-tabs', $nodeid).bind('sortstop', function (event, ui) {
              var idx = $(ui.item).data('idx');
              var newIdx = $(ui.item).index();
              moveNodeTo(idx, newIdx);
              updateTabs(newIdx);
            });
          }
        }

        // Simulate User's click to setup the form with its minItems
        if ((boundaries.minItems >= 0) &&
          (node.children.length <= boundaries.minItems)) {
          for (var i = 0; i < (boundaries.minItems - 1); i++) {
            $nodeid.find('> a._jsonform-array-addmore').click();
          }
          $nodeid.find('> a._jsonform-array-deleteitem').addClass('disabled');
          updateTabs();
        }

        if ((boundaries.maxItems >= 0) &&
          (node.children.length >= boundaries.maxItems)) {
          $nodeid.find('> a._jsonform-array-addmore').addClass('disabled');
        }
        if ((boundaries.minItems >= 0) &&
          (node.children.length <= boundaries.minItems)) {
          $nodeid.find('> a._jsonform-array-deleteitem').addClass('disabled');
        }
      }
    },
    'help': {
      'template': '<span class="help-block" style="padding-top:5px"><%= elt.helpvalue %></span>',
    },
    'msg': {
      'template': '<%= elt.msg %>'
    },
    'fieldset': {
      'template': '<fieldset class="pure-control-group jsonform-error-<%= keydash %> <% if (elt.expandable) { %>expandable<% } %> <%= elt.htmlClass?elt.htmlClass:"" %>" ' +
        '<% if (id) { %> id="<%= id %>"<% } %>' +
        '>' +
        '<% if (node.title || node.legend) { %><legend role="treeitem" aria-expanded="false"><%= node.title || node.legend %></legend><% } %>' +
        '<% if (elt.expandable) { %><div class="pure-control-group"><% } %>' +
        '<%= children %>' +
        '<% if (elt.expandable) { %></div><% } %>' +
        '</fieldset>',
      onInsert: function (evt, node) {
        if (node.el !== null) {
          $('.expandable > div, .expandable > fieldset', node.el).hide();
          // See #233
          $(".expandable", node.el).removeClass("expanded");
        }
      }
    },
    'advancedfieldset': {
      'template': '<fieldset' +
        '<% if (id) { %> id="<%= id %>"<% } %>' +
        ' class="expandable <%= elt.htmlClass?elt.htmlClass:"" %>">' +
        '<legend role="treeitem" aria-expanded="false"><%= (node.title || node.legend) ? (node.title || node.legend) : "Advanced options" %></legend>' +
        '<div class="pure-control-group">' +
        '<%= children %>' +
        '</div>' +
        '</fieldset>',
      onInsert: function (evt, node) {
        if (node.el !== null) {
          $('.expandable > div, .expandable > fieldset', node.el).hide();
          // See #233
          $(".expandable", node.el).removeClass("expanded");
        }
      }
    },
    'authfieldset': {
      'template': '<fieldset' +
        '<% if (id) { %> id="<%= id %>"<% } %>' +
        ' class="expandable <%= elt.htmlClass?elt.htmlClass:"" %>">' +
        '<legend role="treeitem" aria-expanded="false"><%= (node.title || node.legend) ? (node.title || node.legend) : "Authentication settings" %></legend>' +
        '<div class="pure-control-group">' +
        '<%= children %>' +
        '</div>' +
        '</fieldset>',
      onInsert: function (evt, node) {
        if (node.el !== null) {
          $('.expandable > div, .expandable > fieldset', node.el).hide();
          // See #233
          $(".expandable", node.el).removeClass("expanded");
        }
      }
    },
    'submit': {
      template : (data) => `<input type="submit" ${data.id ? `id="${data.id}"` : ''} class="btn btn-primary ${data.elt.htmlClass || ""}" value="${data.value || data.node.title}" ${data.node.disabled ? 'disabled' : ''} />`
    },
    'button': {
      'template': ' <button type="button" <% if (id) { %> id="<%= id %>" <% } %> class="btn btn-default <%= elt.htmlClass?elt.htmlClass:"" %>"><%= node.title %></button> '
    },
    'actions': {
      template : (data) => `<div class="${data.elt.htmlClass || ""}">${data.children}</div>`
    },
    'hidden': {
      'template': '<input type="hidden" id="<%= id %>" name="<%= node.name %>" value="<%= escape(value) %>" />'
    },
    'tabs': {
      'template': '<ul class="nav nav-tabs <%= elt.htmlClass?elt.htmlClass:"" %>"' +
        '<% if (elt.id) { %> id="<%= elt.id %>"<% } %>' +
        '><%=tab_list%></ul><div class="tab-content" <% if (elt.id) { %> data-tabset="<%= elt.id %>"<% } %>><%=children%></div>',
      'getElement': function (el) {
        return $(el).parent().get(0);
      },
      'onBeforeRender': function (data, node) {
        // Generate the initial 'tabs' from the children
        var parentID = escapeHTML(node.id ? node.id + "-" : "")
        var tab_list = '';
        node.children.forEach((child, idx) => {
          var title = escapeHTML(child.title || ('Item ' + (idx + 1)));
          var title_escaped = title.replace(" ", "_");
          tab_list += '<li class="nav-item' +
            ((idx === 0) ? ' active' : '') + '">' +
            '<a href="#' + parentID + title_escaped + '" class="nav-link"' +
            ' data-tab="' + parentID + title_escaped + '"' +
            ' data-toggle="tab">' + title +
            '</a></li>';
        });
        data.tab_list = tab_list;
        return data;
      },
      'onInsert': function (evt, node) {
        $("#" + node.id + ">li.nav-item").on("click", function (e) {
          e.preventDefault();
          $(node.el).find("div[data-tabset='" + node.id + "']>div.tab-pane.active").each(function () {
            $(this).removeClass("active");
          })
          var tab_id = $(this).find('a').attr('data-tab');
          $("#" + tab_id).addClass("active");
        });
      }
    },
    'tab': {
      'template': '<div class="tab-pane' +
        '<% if (elt.htmlClass) { %> <%= elt.htmlClass %> <% } %>' +
        //Set the first tab as active
        '<% if (node.childPos === 0) { %> active<% } %>' +
        '"' + //Finish end quote of class tag
        '<% if (node.title) { %> id="<%= node.parentNode.id %>-<%= node.title.replace(" ","_") %>"<% } %>' +
        '><%= children %></div>'
    },
    'selectfieldset': {
      'template': '<fieldset class="tab-container <%= elt.htmlClass?elt.htmlClass:"" %>">' +
        '<% if (node.legend) { %><legend role="treeitem" aria-expanded="false"><%= node.legend %></legend><% } %>' +
        '<% if (node.formElement.key) { %><input type="hidden" id="<%= node.id %>" name="<%= node.name %>" value="<%= escape(value) %>" /><% } else { %>' +
        '<a id="<%= node.id %>"></a><% } %>' +
        '<div class="tabbable">' +
        '<div class="pure-control-group<%= node.formElement.hideMenu ? " hide" : "" %>">' +
        '<% if (!elt.notitle) { %><label for="<%= node.id %>"><%= node.title ? node.title : node.name %></label><% } %>' +
        '<div class="controls"><%= tabs %></div>' +
        '</div>' +
        '<div class="tab-content">' +
        '<%= children %>' +
        '</div>' +
        '</div>' +
        '</fieldset>',
      'getElement': function (el) {
        return $(el).parent().get(0);
      },
      'childTemplate': function (inner) {
        return '<div data-idx="<%= node.childPos %>" class="tab-pane' +
          '<% if (node.active) { %> active<% } %>">' +
          inner +
          '</div>';
      },
      'onBeforeRender': function (data, node) {
        // Before rendering, this function ensures that:
        // 1. direct children have IDs (used to show/hide the tabs contents)
        // 2. the tab to active is flagged accordingly. The active tab is
        // the first one, except if form values are available, in which case
        // it's the first tab for which there is some value available (or back
        // to the first one if there are none)
        // 3. the HTML of the select field used to select tabs is exposed in the
        // HTML template data as "tabs"

        var children = null;
        var choices = [];
        if (node.schemaElement) {
          choices = node.schemaElement['enum'] || [];
        }
        if (node.options) {
          children = node.options.map((option, idx) => {
            var child = node.children[idx];
            child.childPos = idx; // When nested the childPos is always 0.
            if (option instanceof Object) {
              option = Object.assign({ node: child }, option);
              option.title = option.title ||
                child.legend ||
                child.title ||
                ('Option ' + (child.childPos + 1));
              option.value = isSet(option.value) ? option.value :
                isSet(choices[idx]) ? choices[idx] : idx;
              return option;
            }
            else {
              return {
                title: option,
                value: isSet(choices[child.childPos]) ?
                  choices[child.childPos] :
                  child.childPos,
                node: child
              };
            }
          });
        }
        else {
          children = node.children.map((child, idx) => {
            child.childPos = idx; // When nested the childPos is always 0.
            return {
              title: child.legend || child.title || ('Option ' + (child.childPos + 1)),
              value: choices[child.childPos] || child.childPos,
              node: child
            };
          });
        }

        // Reset each children to inactive so that they are not shown on insert
        // The active one will then be shown later one. This is useful when sorting
        // arrays with selectfieldset, otherwise both fields could be active at the
        // same time.
        children.forEach(child=>{
          child.node.active = false
        });

        var activeChild = null;
        if (data.value) {
          activeChild = children.find(child => {
            return (child.value === node.value);
          });
        }
        if (!activeChild) {
          activeChild = children.find(child => {
            return child.node.hasNonDefaultValue();
          });
        }
        if (!activeChild) {
          activeChild = children[0];
        }
        activeChild.node.active = true;
        data.value = activeChild.value;

        var elt = node.formElement;
        var tabs = '<select class="nav form-control"' +
          (node.disabled ? ' disabled' : '') +
          '>';
        children.forEach((child, idx)=>{
          tabs += '<option data-idx="' + idx + '" value="' + child.value + '"' +
            (child.node.active ? ' selected="selected" class="active"' : '') +
            '>' +
            escapeHTML(child.title) +
            '</option>';
        });
        tabs += '</select>';

        data.tabs = tabs;
        return data;
      },
      'onInsert': function (evt, node) {
        $(node.el).find('select.nav').first().on('change', function (evt) {
          var $option = $(this).find('option:selected');
          $(node.el).find('input[type="hidden"]').first().val($option.attr('value'));
        });
      }
    },
    'optionfieldset': {
      'template': '<div' +
        '<% if (node.id) { %> id="<%= node.id %>"<% } %>' +
        '>' +
        '<%= children %>' +
        '</div>'
    },
    'section': {
      'template': '<div' +
        '<% if (elt.htmlClass) { %> class="<%= elt.htmlClass %>"<% } %>' +
        '<% if (node.id) { %> id="<%= node.id %>"<% } %>' +
        '><%= children %></div>'
    },

    /**
     * A "questions" field renders a series of question fields and binds the
     * result to the value of a schema key.
     */
    'questions': {
      'template': '<div>' +
        '<input type="hidden" id="<%= node.id %>" name="<%= node.name %>" value="<%= escape(value) %>" />' +
        '<%= children %>' +
        '</div>',
      'getElement': function (el) {
        return $(el).parent().get(0);
      },
      'onInsert': function (evt, node) {
        if (!node.children || (node.children.length === 0)) return;
        node.children.forEach(child=>{
          $(child.el).hide();
        });
        $(node.children[0].el).show();
      }
    }
  };


  //Allow to access subproperties by splitting "."
  /**
   * Retrieves the key identified by a path selector in the structured object.
   *
   * Levels in the path are separated by a dot. Array items are marked
   * with [x]. For instance:
   *  foo.bar[3].baz
   *
   * @function
   * @param {Object} obj Structured object to parse
   * @param {String} key Path to the key to retrieve
   * @param {boolean} ignoreArrays True to use first element in an array when
   *   stucked on a property. This parameter is basically only useful when
   *   parsing a JSON schema for which the "items" property may either be an
   *   object or an array with one object (only one because JSON form does not
   *   support mix of items for arrays).
   * @return {Object} The key's value.
   */
  jsonform.util.getObjKey = function (obj, key, ignoreArrays) {
    var innerobj = obj;
    var keyparts = key.split(".");
    var subkey = null;
    var arrayMatch = null;
    var prop = null;

    for (var i = 0; i < keyparts.length; i++) {
      if ((innerobj === null) || (typeof innerobj !== "object")) return null;
      subkey = keyparts[i];
      prop = subkey.replace(reArray, '');
      reArray.lastIndex = 0;
      arrayMatch = reArray.exec(subkey);
      if (arrayMatch) {
        while (true) {
          if (prop && !Array.isArray(innerobj[prop])) return null;
          innerobj = prop ? innerobj[prop][parseInt(arrayMatch[1])] : innerobj[parseInt(arrayMatch[1])];
          arrayMatch = reArray.exec(subkey);
          if (!arrayMatch) break;
          // In the case of multidimensional arrays,
          // we should not take innerobj[prop][0] anymore,
          // but innerobj[0] directly
          prop = null;
        }
      } else if (ignoreArrays &&
        !innerobj[prop] &&
        Array.isArray(innerobj) &&
        innerobj[0]) {
        innerobj = innerobj[0][prop];
      } else {
        innerobj = innerobj[prop];
      }
    }

    if (ignoreArrays && Array.isArray(innerobj) && innerobj[0]) {
      return innerobj[0];
    } else {
      return innerobj;
    }
  };


  /**
   * Sets the key identified by a path selector to the given value.
   *
   * Levels in the path are separated by a dot. Array items are marked
   * with [x]. For instance:
   *  foo.bar[3].baz
   *
   * The hierarchy is automatically created if it does not exist yet.
   *
   * @function
   * @param {Object} obj The object to build
   * @param {String} key The path to the key to set where each level
   *  is separated by a dot, and array items are flagged with [x].
   * @param {Object} value The value to set, may be of any type.
   */
  jsonform.util.setObjKey = function (obj, key, value) {
    var innerobj = obj;
    var keyparts = key.split(".");
    var subkey = null;
    var arrayMatch = null;
    var prop = null;

    for (var i = 0; i < keyparts.length - 1; i++) {
      subkey = keyparts[i];
      prop = subkey.replace(reArray, '');
      reArray.lastIndex = 0;
      arrayMatch = reArray.exec(subkey);
      if (arrayMatch) {
        // Subkey is part of an array
        while (true) {
          if (!Array.isArray(innerobj[prop])) {
            innerobj[prop] = [];
          }
          innerobj = innerobj[prop];
          prop = parseInt(arrayMatch[1], 10);
          arrayMatch = reArray.exec(subkey);
          if (!arrayMatch) break;
        }
        if ((typeof innerobj[prop] !== 'object') ||
          (innerobj[prop] === null)) {
          innerobj[prop] = {};
        }
        innerobj = innerobj[prop];
      }
      else {
        // "Normal" subkey
        if ((typeof innerobj[prop] !== 'object') ||
          (innerobj[prop] === null)) {
          innerobj[prop] = {};
        }
        innerobj = innerobj[prop];
      }
    }

    // Set the final value
    subkey = keyparts[keyparts.length - 1];
    prop = subkey.replace(reArray, '');
    reArray.lastIndex = 0;
    arrayMatch = reArray.exec(subkey);
    if (arrayMatch) {
      while (true) {
        if (!Array.isArray(innerobj[prop])) {
          innerobj[prop] = [];
        }
        innerobj = innerobj[prop];
        prop = parseInt(arrayMatch[1], 10);
        arrayMatch = reArray.exec(subkey);
        if (!arrayMatch) break;
      }
      innerobj[prop] = value;
    }
    else {
      innerobj[prop] = value;
    }
  };


  /**
   * Retrieves the key definition from the given schema.
   *
   * The key is identified by the path that leads to the key in the
   * structured object that the schema would generate. Each level is
   * separated by a '.'. Array levels are marked with []. For instance:
   *  foo.bar[].baz
   * ... to retrieve the definition of the key at the following location
   * in the JSON schema (using a dotted path notation):
   *  foo.properties.bar.items.properties.baz
   *
   * @function
   * @param {Object} schema The JSON schema to retrieve the key from
   * @param {String} key The path to the key, each level being separated
   *  by a dot and array items being flagged with [].
   * @return {Object} The key definition in the schema, null if not found.
   */
  var getSchemaKey = function (schema, key) {
    var schemaKey = key
      .replace(/\./g, '.properties.')
      .replace(/\[[0-9]*\]/g, '.items');
    var schemaDef = jsonform.util.getObjKey(schema, schemaKey, true);
    if (schemaDef && schemaDef.$ref) {
      throw new Error('JSONForm does not yet support schemas that use the ' +
        '$ref keyword. See: https://github.com/joshfire/jsonform/issues/54');
    }
    return schemaDef;
  };


  /**
   * Truncates the key path to the requested depth.
   *
   * For instance, if the key path is:
   *  foo.bar[].baz.toto[].truc[].bidule
   * and the requested depth is 1, the returned key will be:
   *  foo.bar[].baz.toto
   *
   * Note the function includes the path up to the next depth level.
   *
   * @function
   * @param {String} key The path to the key in the schema, each level being
   *  separated by a dot and array items being flagged with [].
   * @param {Number} depth The array depth
   * @return {String} The path to the key truncated to the given depth.
   */
  var truncateToArrayDepth = function (key, arrayDepth) {
    var depth = 0;
    var pos = 0;
    if (!key) return null;

    if (arrayDepth > 0) {
      while (depth < arrayDepth) {
        pos = key.indexOf('[]', pos);
        if (pos === -1) {
          // Key path is not "deep" enough, simply return the full key
          return key;
        }
        pos = pos + 2;
        depth += 1;
      }
    }

    // Move one step further to the right without including the final []
    pos = key.indexOf('[]', pos);
    if (pos === -1) return key;
    else return key.substring(0, pos);
  };

  /**
   * Applies the array path to the key path.
   *
   * For instance, if the key path is:
   *  foo.bar[].baz.toto[].truc[].bidule
   * and the arrayPath [4, 2], the returned key will be:
   *  foo.bar[4].baz.toto[2].truc[].bidule
   *
   * @function
   * @param {String} key The path to the key in the schema, each level being
   *  separated by a dot and array items being flagged with [].
   * @param {Array(Number)} arrayPath The array path to apply, e.g. [4, 2]
   * @return {String} The path to the key that matches the array path.
   */
  var applyArrayPath = function (key, arrayPath) {
    var depth = 0;
    if (!key) return null;
    if (!arrayPath || (arrayPath.length === 0)) return key;
    var newKey = key.replace(reArray, function (str, p1) {
      // Note this function gets called as many times as there are [x] in the ID,
      // from left to right in the string. The goal is to replace the [x] with
      // the appropriate index in the new array path, if defined.
      var newIndex = str;
      if (isSet(arrayPath[depth])) {
        newIndex = '[' + arrayPath[depth] + ']';
      }
      depth += 1;
      return newIndex;
    });
    return newKey;
  };


  /**
   * Returns the initial value that a field identified by its key
   * should take.
   *
   * The "initial" value is defined as:
   * 1. the previously submitted value if already submitted
   * 2. the default value defined in the layout of the form
   * 3. the default value defined in the schema
   *
   * The "value" returned is intended for rendering purpose,
   * meaning that, for fields that define a titleMap property,
   * the function returns the label, and not the intrinsic value.
   *
   * The function handles values that contains template strings,
   * e.g. {{values.foo[].bar}} or {{idx}}.
   *
   * When the form is a string, the function truncates the resulting string
   * to meet a potential "maxLength" constraint defined in the schema, using
   * "..." to mark the truncation. Note it does not validate the resulting
   * string against other constraints (e.g. minLength, pattern) as it would
   * be hard to come up with an automated course of action to "fix" the value.
   *
   * @function
   * @param {Object} formObject The JSON Form object
   * @param {String} key The generic key path (e.g. foo[].bar.baz[])
   * @param {Array(Number)} arrayPath The array path that identifies
   *  the unique value in the submitted form (e.g. [1, 3])
   * @param {Object} tpldata Template data object
   * @param {Boolean} usePreviousValues true to use previously submitted values
   *  if defined.
   */
  var getInitialValue = function (formObject, key, arrayPath, tpldata, usePreviousValues) {
    var value = null;

    // Complete template data for template function
    tpldata = tpldata || {};
    tpldata.idx = tpldata.idx ||
      (arrayPath ? arrayPath[arrayPath.length - 1] : 1);
    tpldata.value = isSet(tpldata.value) ? tpldata.value : '';
    tpldata.getValue = tpldata.getValue || function (key) {
      return getInitialValue(formObject, key, arrayPath, tpldata, usePreviousValues);
    };

    // Helper function that returns the form element that explicitly
    // references the given key in the schema.
    var getFormElement = function (elements, key) {
      var formElement = null;
      if (!elements || !elements.length) return null;
      elements.forEach(elt=>{
        if (formElement) return;
        if (elt === key) {
          formElement = { key: elt };
          return;
        }
        if (typeof (elt) === 'string') return;
        if (elt.key === key) {
          formElement = elt;
        }
        else if (elt.items) {
          formElement = getFormElement(elt.items, key);
        }
      });
      return formElement;
    };
    var formElement = getFormElement(formObject.form || [], key);
    var schemaElement = getSchemaKey(formObject.schema.properties, key);

    if (usePreviousValues && formObject.value) {
      // If values were previously submitted, use them directly if defined
      value = jsonform.util.getObjKey(formObject.value, applyArrayPath(key, arrayPath));
    }
    if (!isSet(value)) {
      if (formElement && (typeof formElement['value'] !== 'undefined')) {
        // Extract the definition of the form field associated with
        // the key as it may override the schema's default value
        // (note a "null" value overrides a schema default value as well)
        value = formElement['value'];
      }
      else if (schemaElement) {
        // Simply extract the default value from the schema
        if (isSet(schemaElement['default'])) {
          value = schemaElement['default'];
        }
      }
      if (value && value.indexOf('{{values.') !== -1) {
        // This label wants to use the value of another input field.
        // Convert that construct into {{getValue(key)}} for
        // Underscore to call the appropriate function of formData
        // when template gets called (note calling a function is not
        // exactly Mustache-friendly but is supported by Underscore).
        value = value.replace(
          /\{\{values\.([^\}]+)\}\}/g,
          '{{getValue("$1")}}');
      }
      if (value) {
        value = tmpl(value, valueTemplateSettings)(tpldata);
      }
    }

    // TODO: handle on the formElement.options, because user can setup it too.
    // Apply titleMap if needed
    if (isSet(value) && formElement && hasOwnProperty(formElement.titleMap, value)) {
      value = tmpl(formElement.titleMap[value], valueTemplateSettings)(tpldata);
    }

    // Check maximum length of a string
    if (value && typeof (value) === 'string' &&
      schemaElement && schemaElement.maxLength) {
      if (value.length > schemaElement.maxLength) {
        // Truncate value to maximum length, adding continuation dots
        value = value.substr(0, schemaElement.maxLength - 1) + '…';
      }
    }

    if (!isSet(value)) {
      return null;
    }
    else {
      return value;
    }
  };


  /**
   * Represents a node in the form.
   *
   * Nodes that have an ID are linked to the corresponding DOM element
   * when rendered
   *
   * Note the form element and the schema elements that gave birth to the
   * node may be shared among multiple nodes (in the case of arrays).
   *
   * @class
   */
  var formNode = function () {
    /**
     * The node's ID (may not be set)
     */
    this.id = null;

    /**
     * The node's key path (may not be set)
     */
    this.key = null;

    /**
     * DOM element associated witht the form element.
     *
     * The DOM element is set when the form element is rendered.
     */
    this.el = null;

    /**
     * Link to the form element that describes the node's layout
     * (note the form element is shared among nodes in arrays)
     */
    this.formElement = null;

    /**
     * Link to the schema element that describes the node's value constraints
     * (note the schema element is shared among nodes in arrays)
     */
    this.schemaElement = null;

    /**
     * Pointer to the "view" associated with the node, typically the right
     * object in jsonform.elementTypes
     */
    this.view = null;

    /**
     * Node's subtree (if one is defined)
     */
    this.children = [];

    /**
     * A pointer to the form tree the node is attached to
     */
    this.ownerTree = null;

    /**
     * A pointer to the parent node of the node in the tree
     */
    this.parentNode = null;

    /**
     * Child template for array-like nodes.
     *
     * The child template gets cloned to create new array items.
     */
    this.childTemplate = null;


    /**
     * Direct children of array-like containers may use the value of a
     * specific input field in their subtree as legend. The link to the
     * legend child is kept here and initialized in computeInitialValues
     * when a child sets "valueInLegend"
     */
    this.legendChild = null;


    /**
     * The path of indexes that lead to the current node when the
     * form element is not at the root array level.
     *
     * Note a form element may well be nested element and still be
     * at the root array level. That's typically the case for "fieldset"
     * elements. An array level only gets created when a form element
     * is of type "array" (or a derivated type such as "tabarray").
     *
     * The array path of a form element linked to the foo[2].bar.baz[3].toto
     * element in the submitted values is [2, 3] for instance.
     *
     * The array path is typically used to compute the right ID for input
     * fields. It is also used to update positions when an array item is
     * created, moved around or suppressed.
     *
     * @type {Array(Number)}
     */
    this.arrayPath = [];

    /**
     * Position of the node in the list of children of its parents
     */
    this.childPos = 0;
  };


  /**
   * Clones a node
   *
   * @function
   * @param {formNode} New parent node to attach the node to
   * @return {formNode} Cloned node
   */
  formNode.prototype.clone = function (parentNode) {
    var node = new formNode();
    node.arrayPath = clone(this.arrayPath);
    node.ownerTree = this.ownerTree;
    node.parentNode = parentNode || this.parentNode;
    node.formElement = this.formElement;
    node.schemaElement = this.schemaElement;
    node.view = this.view;
    node.children = this.children.map(child => {
      return child.clone(node);
    });
    if (this.childTemplate) {
      node.childTemplate = this.childTemplate.clone(node);
    }
    return node;
  };


  /**
   * Returns true if the subtree that starts at the current node
   * has some non empty value attached to it
   */
  formNode.prototype.hasNonDefaultValue = function () {

    // hidden elements don't count because they could make the wrong selectfieldset element active
    if (this.formElement && this.formElement.type == "hidden") {
      return false;
    }

    if (this.value && !this.defaultValue) {
      return true;
    }
    var child = this.children.find(child => {
      return child.hasNonDefaultValue();
    });
    return !!child;
  };


  /**
   * Attaches a child node to the current node.
   *
   * The child node is appended to the end of the list.
   *
   * @function
   * @param {formNode} node The child node to append
   * @return {formNode} The inserted node (same as the one given as parameter)
   */
  formNode.prototype.appendChild = function (node) {
    node.parentNode = this;
    node.childPos = this.children.length;
    this.children.push(node);
    return node;
  };


  /**
   * Removes the last child of the node.
   *
   * @function
   */
  formNode.prototype.removeChild = function () {
    var child = this.children[this.children.length - 1];
    if (!child) return;

    // Remove the child from the DOM
    $(child.el).remove();

    // Remove the child from the array
    return this.children.pop();
  };


  /**
   * Moves the user entered values set in the current node's subtree to the
   * given node's subtree.
   *
   * The target node must follow the same structure as the current node
   * (typically, they should have been generated from the same node template)
   *
   * The current node MUST be rendered in the DOM.
   *
   * TODO: when current node is not in the DOM, extract values from formNode.value
   * properties, so that the function be available even when current node is not
   * in the DOM.
   *
   * Moving values around allows to insert/remove array items at arbitrary
   * positions.
   *
   * @function
   * @param {formNode} node Target node.
   */
  formNode.prototype.moveValuesTo = function (node) {
    var values = this.getFormValues(node.arrayPath);
    node.resetValues();
    node.computeInitialValues(values, true);
  };


  /**
   * Switches nodes user entered values.
   *
   * The target node must follow the same structure as the current node
   * (typically, they should have been generated from the same node template)
   *
   * Both nodes MUST be rendered in the DOM.
   *
   * TODO: update getFormValues to work even if node is not rendered, using
   * formNode's "value" property.
   *
   * @function
   * @param {formNode} node Target node
   */
  formNode.prototype.switchValuesWith = function (node) {
    var values = this.getFormValues(node.arrayPath);
    var nodeValues = node.getFormValues(this.arrayPath);
    node.resetValues();
    node.computeInitialValues(values, true);
    this.resetValues();
    this.computeInitialValues(nodeValues, true);
  };


  /**
   * Resets all DOM values in the node's subtree.
   *
   * This operation also drops all array item nodes.
   * Note values are not reset to their default values, they are rather removed!
   *
   * @function
   */
  formNode.prototype.resetValues = function () {
    var params = null;
    var idx = 0;

    // Reset value
    this.value = null;

    // Propagate the array path from the parent node
    // (adding the position of the child for nodes that are direct
    // children of array-like nodes)
    if (this.parentNode) {
      this.arrayPath = clone(this.parentNode.arrayPath);
      if (this.parentNode.view && this.parentNode.view.array) {
        this.arrayPath.push(this.childPos);
      }
    }
    else {
      this.arrayPath = [];
    }

    if (this.view) {
      // Simple input field, extract the value from the origin,
      // set the target value and reset the origin value
      params = $(':input', this.el).serializeArray();
      params.forEach(param => {
        // TODO: check this, there may exist corner cases with this approach
        // (with multiple checkboxes for instance)
        $('[name="' + escapeSelector(param.name) + '"]', $(this.el)).val('');
      }, this);
    }
    else if (this.view && this.view.array) {
      // The current node is an array, drop all children
      while (this.children.length > 0) {
        this.removeChild();
      }
    }

    // Recurse down the tree
    this.children.forEach(child => {
      child.resetValues();
    });
  };


  /**
   * Sets the child template node for the current node.
   *
   * The child template node is used to create additional children
   * in an array-like form element. The template is never rendered.
   *
   * @function
   * @param {formNode} node The child template node to set
   */
  formNode.prototype.setChildTemplate = function (node) {
    this.childTemplate = node;
    node.parentNode = this;
  };


  /**
   * Recursively sets values to all nodes of the current subtree
   * based on previously submitted values, or based on default
   * values when the submitted values are not enough
   *
   * The function should be called once in the lifetime of a node
   * in the tree. It expects its parent's arrayPath to be up to date.
   *
   * Three cases may arise:
   * 1. if the form element is a simple input field, the value is
   * extracted from previously submitted values of from default values
   * defined in the schema.
   * 2. if the form element is an array-like node, the child template
   * is used to create as many children as possible (and at least one).
   * 3. the function simply recurses down the node's subtree otherwise
   * (this happens when the form element is a fieldset-like element).
   *
   * @function
   * @param {Object} values Previously submitted values for the form
   * @param {Boolean} ignoreDefaultValues Ignore default values defined in the
   *  schema when set.
   */
  formNode.prototype.computeInitialValues = function (values, ignoreDefaultValues) {
    var self = this;
    var node = null;
    var nbChildren = 1;
    var i = 0;
    var formData = this.ownerTree.formDesc.tpldata || {};

    // Propagate the array path from the parent node
    // (adding the position of the child for nodes that are direct
    // children of array-like nodes)
    if (this.parentNode) {
      this.arrayPath = clone(this.parentNode.arrayPath);
      if (this.parentNode.view && this.parentNode.view.array) {
        this.arrayPath.push(this.childPos);
      }
    }
    else {
      this.arrayPath = [];
    }

    // Prepare special data param "idx" for templated values
    // (is is the index of the child in its wrapping array, starting
    // at 1 since that's more human-friendly than a zero-based index)
    formData.idx = (this.arrayPath.length > 0) ?
      this.arrayPath[this.arrayPath.length - 1] + 1 :
      this.childPos + 1;

    // Prepare special data param "value" for templated values
    formData.value = '';

    // Prepare special function to compute the value of another field
    formData.getValue = function (key) {
      if (!values) {
        return '';
      }
      var returnValue = values;
      var listKey = key.split('[].');
      var i;
      for (i = 0; i < listKey.length - 1; i++) {
        returnValue = returnValue[listKey[i]][self.arrayPath[i]];
      }
      return returnValue[listKey[i]];
    };

    if (this.formElement) {
      // Compute the ID of the field (if needed)
      if (this.formElement.id) {
        this.id = applyArrayPath(this.formElement.id, this.arrayPath);
      }
      else if (this.view && this.view.array) {
        this.id = escapeSelector(this.ownerTree.formDesc.prefix) +
          '-elt-counter-' + Date.now();
      }
      else if (this.parentNode && this.parentNode.view &&
        this.parentNode.view.array) {
        // Array items need an array to associate the right DOM element
        // to the form node when the parent is rendered.
        this.id = escapeSelector(this.ownerTree.formDesc.prefix) +
          '-elt-counter-' + Date.now();
      }
      else if ((this.formElement.type === 'button') ||
        (this.formElement.type === 'selectfieldset') ||
        (this.formElement.type === 'question') ||
        (this.formElement.type === 'buttonquestion')) {
        // Buttons do need an id for "onClick" purpose
        this.id = escapeSelector(this.ownerTree.formDesc.prefix) +
          '-elt-counter-' + Date.now();
      }

      // Compute the actual key (the form element's key is index-free,
      // i.e. it looks like foo[].bar.baz[].truc, so we need to apply
      // the array path of the node to get foo[4].bar.baz[2].truc)
      if (this.formElement.key) {
        this.key = applyArrayPath(this.formElement.key, this.arrayPath);
        this.keydash = slugify(this.key.replace(/\./g, '---'));
      }

      // Same idea for the field's name
      this.name = applyArrayPath(this.formElement.name, this.arrayPath);

      // Consider that label values are template values and apply the
      // form's data appropriately (note we also apply the array path
      // although that probably doesn't make much sense for labels...)
      [
        'title',
        'legend',
        'description',
        'append',
        'prepend',
        'inlinetitle',
        'helpvalue',
        'value',
        'disabled',
        'placeholder',
        'readOnly'
      ].forEach(prop => {
        if (typeof (this.formElement[prop]) === 'string') {
          if (this.formElement[prop].indexOf('{{values.') !== -1) {
            // This label wants to use the value of another input field.
            // Convert that construct into {{jsonform.getValue(key)}} for
            // Underscore to call the appropriate function of formData
            // when template gets called (note calling a function is not
            // exactly Mustache-friendly but is supported by Underscore).
            this[prop] = this.formElement[prop].replace(
              /\{\{values\.([^\}]+)\}\}/g,
              '{{getValue("$1")}}');
          }
          else {
            // Note applying the array path probably doesn't make any sense,
            // but some geek might want to have a label "foo[].bar[].baz",
            // with the [] replaced by the appropriate array path.
            this[prop] = applyArrayPath(this.formElement[prop], this.arrayPath);
          }
          if (this[prop]) {
            this[prop] = tmpl(this[prop], valueTemplateSettings)(formData);
          }
        }
        else {
          this[prop] = this.formElement[prop];
        }
      }, this);

      // Apply templating to options created with "titleMap" as well
      if (this.formElement.options) {
        this.options = this.formElement.options.map(option => {
          var title = null;
          if (typeof option === 'object' && option.title) {
            // See a few lines above for more details about templating
            // preparation here.
            if (option.title.indexOf('{{values.') !== -1) {
              title = option.title.replace(
                /\{\{values\.([^\}]+)\}\}/g,
                '{{getValue("$1")}}');
            }
            else {
              title = applyArrayPath(option.title, self.arrayPath);
            }
            return Object.assign({}, option, {
              value: (isSet(option.value) ? option.value : ''),
              title: tmpl(title, valueTemplateSettings)(formData)
            });
          }
          else {
            return option;
          }
        });
      }
    }

    if (this.view && this.schemaElement) {
      // Case 1: simple input field
      if (values) {
        // Form has already been submitted, use former value if defined.
        // Note we won't set the field to its default value otherwise
        // (since the user has already rejected it)
        if (isSet(jsonform.util.getObjKey(values, this.key))) {
          this.value = jsonform.util.getObjKey(values, this.key);
        } else if (isSet(this.schemaElement['default'])) {
          // the value is not provided in the values section but the
          // default is set in the schemaElement (which we have)
          this.value = this.schemaElement['default']
          // We only apply a template if it's a string
          if (typeof this.value === 'string') {
            this.value = tmpl(this.value, valueTemplateSettings)(formData);
          }

        }
      }
      else if (!ignoreDefaultValues) {
        // No previously submitted form result, use default value
        // defined in the schema if it's available and not already
        // defined in the form element
        if (!isSet(this.value) && isSet(this.schemaElement['default'])) {
          this.value = this.schemaElement['default'];
          if (typeof this.value === 'string') {
            if (this.value.indexOf('{{values.') !== -1) {
              // This label wants to use the value of another input field.
              // Convert that construct into {{jsonform.getValue(key)}} for
              // Underscore to call the appropriate function of formData
              // when template gets called (note calling a function is not
              // exactly Mustache-friendly but is supported by Underscore).
              this.value = this.value.replace(
                /\{\{values\.([^\}]+)\}\}/g,
                '{{getValue("$1")}}');
            }
            else {
              // Note applying the array path probably doesn't make any sense,
              // but some geek might want to have a label "foo[].bar[].baz",
              // with the [] replaced by the appropriate array path.
              this.value = applyArrayPath(this.value, this.arrayPath);
            }
            if (this.value) {
              this.value = tmpl(this.value, valueTemplateSettings)(formData);
            }
          }
          this.defaultValue = true;
        }
      }
    }
    else if (this.view && this.view.array) {
      // Case 2: array-like node
      nbChildren = 0;
      if (values) {
        nbChildren = this.getPreviousNumberOfItems(values, this.arrayPath);
      }
      // TODO: use default values at the array level when form has not been
      // submitted before. Note it's not that easy because each value may
      // be a complex structure that needs to be pushed down the subtree.
      // The easiest way is probably to generate a "values" object and
      // compute initial values from that object
      /*
      else if (this.schemaElement['default']) {
        nbChildren = this.schemaElement['default'].length;
      }
      */
      else if (nbChildren === 0) {
        // If form has already been submitted with no children, the array
        // needs to be rendered without children. If there are no previously
        // submitted values, the array gets rendered with one empty item as
        // it's more natural from a user experience perspective. That item can
        // be removed with a click on the "-" button.
        nbChildren = 1;
      }
      for (i = 0; i < nbChildren; i++) {
        this.appendChild(this.childTemplate.clone());
      }
    }

    // Case 3 and in any case: recurse through the list of children
    this.children.forEach(child => {
      child.computeInitialValues(values, ignoreDefaultValues);
    });

    // If the node's value is to be used as legend for its "container"
    // (typically the array the node belongs to), ensure that the container
    // has a direct link to the node for the corresponding tab.
    if (this.formElement && this.formElement.valueInLegend) {
      node = this;
      while (node) {
        if (node.parentNode &&
          node.parentNode.view &&
          node.parentNode.view.array) {
          node.legendChild = this;
          if (node.formElement && node.formElement.legend) {
            node.legend = applyArrayPath(node.formElement.legend, node.arrayPath);
            formData.idx = (node.arrayPath.length > 0) ?
              node.arrayPath[node.arrayPath.length - 1] + 1 :
              node.childPos + 1;
            formData.value = isSet(this.value) ? this.value : '';
            node.legend = tmpl(node.legend, valueTemplateSettings)(formData);
            break;
          }
        }
        node = node.parentNode;
      }
    }
  };


  /**
   * Returns the number of items that the array node should have based on
   * previously submitted values.
   *
   * The whole difficulty is that values may be hidden deep in the subtree
   * of the node and may actually target different arrays in the JSON schema.
   *
   * @function
   * @param {Object} values Previously submitted values
   * @param {Array(Number)} arrayPath the array path we're interested in
   * @return {Number} The number of items in the array
   */
  formNode.prototype.getPreviousNumberOfItems = function (values, arrayPath) {
    var key = null;
    var arrayValue = null;
    var childNumbers = null;
    var idx = 0;

    if (!values) {
      // No previously submitted values, no need to go any further
      return 0;
    }

    if (this.schemaElement) {
      // Case 1: node is a simple input field that links to a key in the schema.
      // The schema key looks typically like:
      //  foo.bar[].baz.toto[].truc[].bidule
      // The goal is to apply the array path and truncate the key to the last
      // array we're interested in, e.g. with an arrayPath [4, 2]:
      //  foo.bar[4].baz.toto[2]
      key = truncateToArrayDepth(this.formElement.key, arrayPath.length);
      key = applyArrayPath(key, arrayPath);
      arrayValue = jsonform.util.getObjKey(values, key);
      if (!arrayValue) {
        // No key? That means this field had been left empty
        // in previous submit
        return 0;
      }
      childNumbers = this.children.map(child => {
        return child.getPreviousNumberOfItems(values, arrayPath);
      });
      return Math.max(...[Math.max(...childNumbers) || 0, arrayValue.length]);
    }
    else if (this.view.array) {
      // Case 2: node is an array-like node, look for input fields
      // in its child template
      return this.childTemplate.getPreviousNumberOfItems(values, arrayPath);
    }
    else {
      // Case 3: node is a leaf or a container,
      // recurse through the list of children and return the maximum
      // number of items found in each subtree
      childNumbers = this.children.map(child => {
        return child.getPreviousNumberOfItems(values, arrayPath);
      });
      return Math.max(...childNumbers) || 0;
    }
  };


  /**
   * Returns the structured object that corresponds to the form values entered
   * by the user for the node's subtree.
   *
   * The returned object follows the structure of the JSON schema that gave
   * birth to the form.
   *
   * Obviously, the node must have been rendered before that function may
   * be called.
   *
   * @function
   * @param {Array(Number)} updateArrayPath Array path to use to pretend that
   *  the entered values were actually entered for another item in an array
   *  (this is used to move values around when an item is inserted/removed/moved
   *  in an array)
   * @return {Object} The object that follows the data schema and matches the
   *  values entered by the user.
   */
  formNode.prototype.getFormValues = function (updateArrayPath) {
    // The values object that will be returned
    var values = {};

    if (!this.el) {
      throw new Error('formNode.getFormValues can only be called on nodes that are associated with a DOM element in the tree');
    }

    // Form fields values
    var formArray = $(':input', this.el).serializeArray();

    // Set values to false for unset checkboxes and radio buttons
    // because serializeArray() ignores them
    formArray = formArray.concat(
      $(':input[type=checkbox]:not(:disabled):not(:checked)', this.el).map(function () {
        return { "name": this.name, "value": this.checked }
      }).get()
    );

    if (updateArrayPath) {
      formArray.forEach(param => {
        param.name = applyArrayPath(param.name, updateArrayPath);
      });
    }

    // The underlying data schema
    var formSchema = this.ownerTree.formDesc.schema;

    for (var i = 0; i < formArray.length; i++) {
      // Retrieve the key definition from the data schema
      var name = formArray[i].name;
      var eltSchema = getSchemaKey(formSchema.properties, name);
      var arrayMatch = null;
      var cval = null;

      // Skip the input field if it's not part of the schema
      if (!eltSchema) continue;

      // Handle multiple checkboxes separately as the idea is to generate
      // an array that contains the list of enumeration items that the user
      // selected.
      if (eltSchema._jsonform_checkboxes_as_array) {
        arrayMatch = name.match(/\[([0-9]*)\]$/);
        if (arrayMatch) {
          name = name.replace(/\[([0-9]*)\]$/, '');
          cval = jsonform.util.getObjKey(values, name) || [];
          if (formArray[i].value === '1') {
            // Value selected, push the corresponding enumeration item
            // to the data result
            cval.push(eltSchema['enum'][parseInt(arrayMatch[1], 10)]);
          }
          jsonform.util.setObjKey(values, name, cval);
          continue;
        }
      }

      // Type casting
      if (eltSchema.type === 'boolean') {
        if (formArray[i].value === '0') {
          formArray[i].value = false;
        } else {
          formArray[i].value = !!formArray[i].value;
        }
      }
      if ((eltSchema.type === 'number') ||
        (eltSchema.type === 'integer')) {
        if (typeof (formArray[i].value) === 'string') {
          if (!formArray[i].value.length) {
            formArray[i].value = null;
          } else if (!isNaN(Number(formArray[i].value))) {
            formArray[i].value = Number(formArray[i].value);
          }
        }
      }
      if ((eltSchema.type === 'string') &&
        (formArray[i].value === '') &&
        !eltSchema._jsonform_allowEmpty) {
        formArray[i].value = null;
      }
      if ((eltSchema.type === 'object') &&
        typeof (formArray[i].value) === 'string' &&
        (formArray[i].value.substring(0, 1) === '{')) {
        try {
          formArray[i].value = JSON.parse(formArray[i].value);
        } catch (e) {
          formArray[i].value = {};
        }
      }
      //TODO: is this due to a serialization bug?
      if ((eltSchema.type === 'object') &&
        (formArray[i].value === 'null' || formArray[i].value === '')) {
        formArray[i].value = null;
      }

      if (formArray[i].name && (formArray[i].value !== null)) {
        jsonform.util.setObjKey(values, formArray[i].name, formArray[i].value);
      }
    }
    return values;
  };



  /**
   * Renders the node.
   *
   * Rendering is done in three steps: HTML generation, DOM element creation
   * and insertion, and an enhance step to bind event handlers.
   *
   * @function
   * @param {Node} el The DOM element where the node is to be rendered. The
   *  node is inserted at the right position based on its "childPos" property.
   */
  formNode.prototype.render = function (el) {
    var html = this.generate();
    this.setContent(html, el);
    this.enhance();
  };


  /**
   * Inserts/Updates the HTML content of the node in the DOM.
   *
   * If the HTML is an update, the new HTML content replaces the old one.
   * The new HTML content is not moved around in the DOM in particular.
   *
   * The HTML is inserted at the right position in its parent's DOM subtree
   * otherwise (well, provided there are enough children, but that should always
   * be the case).
   *
   * @function
   * @param {string} html The HTML content to render
   * @param {Node} parentEl The DOM element that is to contain the DOM node.
   *  This parameter is optional (the node's parent is used otherwise) and
   *  is ignored if the node to render is already in the DOM tree.
   */
  formNode.prototype.setContent = function (html, parentEl) {
    var node = $(html);
    var parentNode = parentEl ||
      (this.parentNode ? this.parentNode.el : this.ownerTree.domRoot);
    var nextSibling = null;

    if (this.el) {
      // Replace the contents of the DOM element if the node is already in the tree
      $(this.el).replaceWith(node);
    }
    else {
      // Insert the node in the DOM if it's not already there
      nextSibling = $(parentNode).children().get(this.childPos);
      if (nextSibling) {
        $(nextSibling).before(node);
      }
      else {
        $(parentNode).append(node);
      }
    }

    // Save the link between the form node and the generated HTML
    this.el = node;

    // Update the node's subtree, extracting DOM elements that match the nodes
    // from the generated HTML
    this.updateElement(this.el);
  };


  /**
   * Updates the DOM element associated with the node.
   *
   * Only nodes that have ID are directly associated with a DOM element.
   *
   * @function
   */
  formNode.prototype.updateElement = function (domNode) {
    if (this.id) {
      this.el = $('#' + escapeSelector(this.id), domNode).get(0);
      if (this.view && this.view.getElement) {
        this.el = this.view.getElement(this.el);
      }
      // if ((this.fieldtemplate !== false) &&
      //   this.view && this.view.fieldtemplate) {
        // The field template wraps the element two or three level deep
        // in the DOM tree, depending on whether there is anything prepended
        // or appended to the input field
        this.el = $(this.el).parent().parent();
        if (this.prepend || this.prepend) {
          this.el = this.el.parent();
        }
        this.el = this.el.get(0);
      //}
      if (this.parentNode && this.parentNode.view &&
        this.parentNode.view.childTemplate) {
        // TODO: the child template may introduce more than one level,
        // so the number of levels introduced should rather be exposed
        // somehow in jsonform.fieldtemplate.
        this.el = $(this.el).parent().get(0);
      }
    }

    for (const k in this.children) {
      if (this.children.hasOwnProperty(k) == false) {
        continue;
      }
      this.children[k].updateElement(this.el || domNode);
    }
  };


  /**
   * Generates the view's HTML content for the underlying model.
   *
   * @function
   */
  formNode.prototype.generate = function () {
    var data = {
      id: this.id,
      keydash: this.keydash,
      elt: this.formElement,
      schema: this.schemaElement,
      node: this,
      value: isSet(this.value) ? this.value : '',
      escape: escapeHTML
    };
    var template = null;
    var html = '';

    // Complete the data context if needed
    if (this.ownerTree.formDesc.onBeforeRender) {
      this.ownerTree.formDesc.onBeforeRender(data, this);
    }
    if (this.view.onBeforeRender) {
      this.view.onBeforeRender(data, this);
    }

    // Use the template that 'onBeforeRender' may have set,
    // falling back to that of the form element otherwise
    if (this.template) {
      template = this.template;
    }
    else if (this.formElement && this.formElement.template) {
      template = this.formElement.template;
    }
    else {
      template = this.view.template;
    }

    // Wrap the view template in the generic field template
    // (note the strict equality to 'false', needed as we fallback
    // to the view's setting otherwise)
    // if ((this.fieldtemplate !== false) &&
    //   (this.fieldtemplate || this.view.fieldtemplate)) {
    //   template = jsonform.fieldTemplate(template, data.elt, data.node);
    // }

    // Wrap the content in the child template of its parent if necessary.
    if (this.parentNode && this.parentNode.view &&
      this.parentNode.view.childTemplate) {
      // only allow drag of children if default or enabled
      template = this.parentNode.view.childTemplate(template, (!isSet(this.parentNode.formElement.draggable) ? true : this.parentNode.formElement.draggable));
    }

    // Prepare the HTML of the children
    var childrenhtml = '';
    this.children.forEach(child => {
      childrenhtml += child.generate();
    });
    data.children = childrenhtml;

    data.fieldHtmlClass = '';
    if (this.ownerTree &&
      this.ownerTree.formDesc &&
      this.ownerTree.formDesc.params &&
      this.ownerTree.formDesc.params.fieldHtmlClass) {
      data.fieldHtmlClass = this.ownerTree.formDesc.params.fieldHtmlClass;
    }
    if (this.formElement &&
      (typeof this.formElement.fieldHtmlClass !== 'undefined')) {
      data.fieldHtmlClass = this.formElement.fieldHtmlClass;
    }

    // Apply the HTML template
    html = template(data);
    html = jsonform.fieldTemplate(html, data.elt, data.node);
    return html;
  };


  /**
   * Enhances the view with additional logic, binding event handlers
   * in particular.
   *
   * The function also runs the "insert" event handler of the view and
   * form element if they exist (starting with that of the view)
   *
   * @function
   */
  formNode.prototype.enhance = function () {
    var node = this;
    var handlers = null;
    var handler = null;
    var formData = clone(this.ownerTree.formDesc.tpldata) || {};

    if (this.formElement) {
      // Check the view associated with the node as it may define an "onInsert"
      // event handler to be run right away
      if (this.view.onInsert) {
        this.view.onInsert({ target: $(this.el) }, this);
      }

      handlers = this.handlers || this.formElement.handlers;

      // Trigger the "insert" event handler
      handler = this.onInsert || this.formElement.onInsert;
      if (handler) {
        handler({ target: $(this.el) }, this);
      }
      if (handlers) {
        Object.keys(handlers).forEach((handler, onevent) => {
          if (onevent === 'insert') {
            handler({ target: $(this.el) }, this);
          }
        }, this);
      }

      // No way to register event handlers if the DOM element is unknown
      // TODO: find some way to register event handlers even when this.el is not set.
      if (this.el) {

        // Register specific event handlers
        // TODO: Add support for other event handlers
        if (this.onChange)
          $(this.el).bind('change', function (evt) { node.onChange(evt, node); });
        if (this.view.onChange)
          $(this.el).bind('change', function (evt) { node.view.onChange(evt, node); });
        if (this.formElement.onChange)
          $(this.el).bind('change', function (evt) { node.formElement.onChange(evt, node); });

        if (this.onInput)
          $(this.el).bind('input', function (evt) { node.onInput(evt, node); });
        if (this.view.onInput)
          $(this.el).bind('input', function (evt) { node.view.onInput(evt, node); });
        if (this.formElement.onInput)
          $(this.el).bind('input', function (evt) { node.formElement.onInput(evt, node); });

        if (this.onClick)
          $(this.el).bind('click', function (evt) { node.onClick(evt, node); });
        if (this.view.onClick)
          $(this.el).bind('click', function (evt) { node.view.onClick(evt, node); });
        if (this.formElement.onClick)
          $(this.el).bind('click', function (evt) { node.formElement.onClick(evt, node); });

        if (this.onKeyUp)
          $(this.el).bind('keyup', function (evt) { node.onKeyUp(evt, node); });
        if (this.view.onKeyUp)
          $(this.el).bind('keyup', function (evt) { node.view.onKeyUp(evt, node); });
        if (this.formElement.onKeyUp)
          $(this.el).bind('keyup', function (evt) { node.formElement.onKeyUp(evt, node); });

        if (handlers) {
          Object.keys(handlers).forEach((handler, onevent) => {
            if (onevent !== 'insert') {
              $(this.el).bind(onevent, function (evt) { handler(evt, node); });
            }
          }, this);
        }
      }

      // Auto-update legend based on the input field that's associated with it
      if (this.legendChild && this.legendChild.formElement) {
        var onChangeHandler = function (evt) {
          if (node.formElement && node.formElement.legend && node.parentNode) {
            node.legend = applyArrayPath(node.formElement.legend, node.arrayPath);
            formData.idx = (node.arrayPath.length > 0) ?
              node.arrayPath[node.arrayPath.length - 1] + 1 :
              node.childPos + 1;
            formData.value = $(evt.target).val();
            node.legend = tmpl(node.legend, valueTemplateSettings)(formData);
            $(node.parentNode.el).trigger('legendUpdated');
          }
        };
        $(this.legendChild.el).bind('change', onChangeHandler);
        $(this.legendChild.el).bind('keyup', onChangeHandler);
      }
    }

    // Recurse down the tree to enhance children
    this.children.forEach(child => {
      child.enhance();
    });
  };



  /**
   * Inserts an item in the array at the requested position and renders the item.
   *
   * @function
   * @param {Number} idx Insertion index
   */
  formNode.prototype.insertArrayItem = function (idx, domElement) {
    var i = 0;

    // Insert element at the end of the array if index is not given
    if (idx === undefined) {
      idx = this.children.length;
    }

    // Create the additional array item at the end of the list,
    // using the item template created when tree was initialized
    // (the call to resetValues ensures that 'arrayPath' is correctly set)
    var child = this.childTemplate.clone();
    this.appendChild(child);
    child.resetValues();

    // To create a blank array item at the requested position,
    // shift values down starting at the requested position
    // one to insert (note we start with the end of the array on purpose)
    for (i = this.children.length - 2; i >= idx; i--) {
      this.children[i].moveValuesTo(this.children[i + 1]);
    }

    // Initialize the blank node we've created with default values
    this.children[idx].resetValues();
    this.children[idx].computeInitialValues();

    // Re-render all children that have changed
    for (i = idx; i < this.children.length; i++) {
      this.children[i].render(domElement);
    }
  };


  /**
   * Remove an item from an array
   *
   * @function
   * @param {Number} idx The index number of the item to remove
   */
  formNode.prototype.deleteArrayItem = function (idx) {
    var i = 0;
    var child = null;

    // Delete last item if no index is given
    if (idx === undefined) {
      idx = this.children.length - 1;
    }

    // Move values up in the array
    for (i = idx; i < this.children.length - 1; i++) {
      this.children[i + 1].moveValuesTo(this.children[i]);
      this.children[i].render();
    }

    // Remove the last array item from the DOM tree and from the form tree
    this.removeChild();
  };

  /**
   * Returns the minimum/maximum number of items that an array field
   * is allowed to have according to the schema definition of the fields
   * it contains.
   *
   * The function parses the schema definitions of the array items that
   * compose the current "array" node and returns the minimum value of
   * "maxItems" it encounters as the maximum number of items, and the
   * maximum value of "minItems" as the minimum number of items.
   *
   * The function reports a -1 for either of the boundaries if the schema
   * does not put any constraint on the number of elements the current
   * array may have of if the current node is not an array.
   *
   * Note that array boundaries should be defined in the JSON Schema using
   * "minItems" and "maxItems". The code also supports "minLength" and
   * "maxLength" as a fallback, mostly because it used to by mistake (see #22)
   * and because other people could make the same mistake.
   *
   * @function
   * @return {Object} An object with properties "minItems" and "maxItems"
   *  that reports the corresponding number of items that the array may
   *  have (value is -1 when there is no constraint for that boundary)
   */
  formNode.prototype.getArrayBoundaries = function () {
    var boundaries = {
      minItems: -1,
      maxItems: -1
    };
    if (!this.view || !this.view.array) return boundaries;

    var getNodeBoundaries = function (node, initialNode) {
      var schemaKey = null;
      var arrayKey = null;
      var boundaries = {
        minItems: -1,
        maxItems: -1
      };
      initialNode = initialNode || node;

      if (node.view && node.view.array && (node !== initialNode)) {
        // New array level not linked to an array in the schema,
        // so no size constraints
        return boundaries;
      }

      if (node.key) {
        // Note the conversion to target the actual array definition in the
        // schema where minItems/maxItems may be defined. If we're still looking
        // at the initial node, the goal is to convert from:
        //  foo[0].bar[3].baz to foo[].bar[].baz
        // If we're not looking at the initial node, the goal is to look at the
        // closest array parent:
        //  foo[0].bar[3].baz to foo[].bar
        arrayKey = node.key.replace(/\[[0-9]+\]/g, '[]');
        if (node !== initialNode) {
          arrayKey = arrayKey.replace(/\[\][^\[\]]*$/, '');
        }
        schemaKey = getSchemaKey(
          node.ownerTree.formDesc.schema.properties,
          arrayKey
        );
        if (!schemaKey) return boundaries;
        return {
          minItems: schemaKey.minItems || schemaKey.minLength || -1,
          maxItems: schemaKey.maxItems || schemaKey.maxLength || -1
        };
      }
      else {
        node.children.forEach(child => {
          var subBoundaries = getNodeBoundaries(child, initialNode);
          if (subBoundaries.minItems !== -1) {
            if (boundaries.minItems !== -1) {
              boundaries.minItems = Math.max(
                boundaries.minItems,
                subBoundaries.minItems
              );
            }
            else {
              boundaries.minItems = subBoundaries.minItems;
            }
          }
          if (subBoundaries.maxItems !== -1) {
            if (boundaries.maxItems !== -1) {
              boundaries.maxItems = Math.min(
                boundaries.maxItems,
                subBoundaries.maxItems
              );
            }
            else {
              boundaries.maxItems = subBoundaries.maxItems;
            }
          }
        });
      }
      return boundaries;
    };
    return getNodeBoundaries(this);
  };


  /**
   * Form tree class.
   *
   * Holds the internal representation of the form.
   * The tree is always in sync with the rendered form, this allows to parse
   * it easily.
   *
   * @class
   */
  var formTree = function () {
    this.eventhandlers = [];
    this.root = null;
    this.formDesc = null;
  };

  /**
   * Initializes the form tree structure from the JSONForm object
   *
   * This function is the main entry point of the JSONForm library.
   *
   * Initialization steps:
   * 1. the internal tree structure that matches the JSONForm object
   *  gets created (call to buildTree)
   * 2. initial values are computed from previously submitted values
   *  or from the default values defined in the JSON schema.
   *
   * When the function returns, the tree is ready to be rendered through
   * a call to "render".
   *
   * @function
   */
  formTree.prototype.initialize = function (formDesc) {
    formDesc = formDesc || {};

    // Keep a pointer to the initial JSONForm
    // (note clone returns a shallow copy, only first-level is cloned)
    this.formDesc = clone(formDesc);

    // Compute form prefix if no prefix is given.
    this.formDesc.prefix = this.formDesc.prefix ||
      'jsonform-' + Date.now();

    // JSON schema shorthand
    if (this.formDesc.schema && !this.formDesc.schema.properties) {
      this.formDesc.schema = {
        properties: this.formDesc.schema
      };
    }

    // Ensure layout is set
    this.formDesc.form = this.formDesc.form || [
      '*',
      {
        type: 'actions',
        items: [
          {
            type: 'submit',
            value: 'Submit'
          }
        ]
      }
    ];
    this.formDesc.form = (Array.isArray(this.formDesc.form) ?
      this.formDesc.form :
      [this.formDesc.form]);

    this.formDesc.params = this.formDesc.params || {};

    // Create the root of the tree
    this.root = new formNode();
    this.root.ownerTree = this;
    this.root.view = jsonform.elementTypes['root'];

    // Generate the tree from the form description
    this.buildTree();

    // Compute the values associated with each node
    // (for arrays, the computation actually creates the form nodes)
    this.computeInitialValues();
  };


  /**
   * Constructs the tree from the form description.
   *
   * The function must be called once when the tree is first created.
   *
   * @function
   */
  formTree.prototype.buildTree = function () {
    // Parse and generate the form structure based on the elements encountered:
    // - '*' means "generate all possible fields using default layout"
    // - a key reference to target a specific data element
    // - a more complex object to generate specific form sections
    this.formDesc.form.forEach(formElement => {
      if (formElement === '*') {
        Object.keys(this.formDesc.schema.properties).forEach(key => {
          this.root.appendChild(this.buildFromLayout({
            key: key
          }));
        }, this);
      }
      else {
        if (typeof (formElement) === 'string') {
          formElement = {
            key: formElement
          };
        }
        this.root.appendChild(this.buildFromLayout(formElement));
      }
    }, this);
  };


  /**
   * Builds the internal form tree representation from the requested layout.
   *
   * The function is recursive, generating the node children as necessary.
   * The function extracts the values from the previously submitted values
   * (this.formDesc.value) or from default values defined in the schema.
   *
   * @function
   * @param {Object} formElement JSONForm element to render
   * @param {Object} context The parsing context (the array depth in particular)
   * @return {Object} The node that matches the element.
   */
  formTree.prototype.buildFromLayout = function (formElement, context) {
    var schemaElement = null;
    var node = new formNode();
    var view = null;
    var key = null;

    // The form element parameter directly comes from the initial
    // JSONForm object. We'll make a shallow copy of it and of its children
    // not to pollute the original object.
    // (note JSON.parse(JSON.stringify()) cannot be used since there may be
    // event handlers in there!)
    formElement = clone(formElement);
    if (formElement.items) {
      formElement.items = clone(formElement.items);
    }

    if (formElement.key) {
      // The form element is directly linked to an element in the JSON
      // schema. The properties of the form element override those of the
      // element in the JSON schema. Properties from the JSON schema complete
      // those of the form element otherwise.

      // Retrieve the element from the JSON schema
      schemaElement = getSchemaKey(
        this.formDesc.schema.properties,
        formElement.key);
      if (!schemaElement) {
        // The JSON Form is invalid!
        throw new Error('The JSONForm object references the schema key "' +
          formElement.key + '" but that key does not exist in the JSON schema');
      }

      // Schema element has just been found, let's trigger the
      // "onElementSchema" event
      // (tidoust: not sure what the use case for this is, keeping the
      // code for backward compatibility)
      if (this.formDesc.onElementSchema) {
        this.formDesc.onElementSchema(formElement, schemaElement);
      }

      formElement.name =
        formElement.name ||
        formElement.key;
      formElement.title =
        formElement.title ||
        schemaElement.title;
      formElement.description =
        formElement.description ||
        schemaElement.description;
      formElement.readOnly =
        formElement.readOnly ||
        schemaElement.readOnly ||
        formElement.readonly ||
        schemaElement.readonly;

      // Compute the ID of the input field
      if (!formElement.id) {
        formElement.id = escapeSelector(this.formDesc.prefix) +
          '-elt-' + slugify(formElement.key);
      }

      // Should empty strings be included in the final value?
      // TODO: it's rather unclean to pass it through the schema.
      if (formElement.allowEmpty) {
        schemaElement._jsonform_allowEmpty = true;
      }

      // If the form element does not define its type, use the type of
      // the schema element.
      if (!formElement.type) {
        // If schema type is an array containing only a type and "null",
        // remove null and make the element non-required
        if (Array.isArray(schemaElement.type)) {
          if (schemaElement.type.includes("null")) {
            schemaElement.type = schemaElement.type.filter(type => type !== "null");
            schemaElement.required = false;
          }
          if (schemaElement.type.length > 1) {
            throw new Error("Cannot process schema element with multiple types.");
          }
          schemaElement.type = Array.isArray(schemaElement.type) ? schemaElement.type[0] : schemaElement.type;
        }

        if ((schemaElement.type === 'string') &&
          (schemaElement.format === 'color')) {
          formElement.type = 'color';
        } else if ((schemaElement.type === 'number' ||
          schemaElement.type === 'integer') &&
          !schemaElement['enum']) {
          formElement.type = 'number';
          if (schemaElement.type === 'number') schemaElement.step = 'any';
        } else if ((schemaElement.type === 'string' ||
          schemaElement.type === 'any') &&
          !schemaElement['enum']) {
          formElement.type = 'text';
        } else if (schemaElement.type === 'boolean') {
          formElement.type = 'checkbox';
        } else if (schemaElement.type === 'object') {
          if (schemaElement.properties) {
            formElement.type = 'fieldset';
          } else {
            formElement.type = 'textarea';
          }
        } else if (typeof schemaElement['enum'] !== 'undefined') {
          formElement.type = 'select';
        } else {
          formElement.type = schemaElement.type;
        }
      }

      // Unless overridden in the definition of the form element (or unless
      // there's a titleMap defined), use the enumeration list defined in
      // the schema
      if (!formElement.options && schemaElement['enum']) {
        if (formElement.titleMap) {
          formElement.options = schemaElement['enum'].map(value => {
            return {
              value: value,
              title: hasOwnProperty(formElement.titleMap, value) ? formElement.titleMap[value] : value
            };
          });
        }
        else {
          formElement.options = schemaElement['enum'];
        }
      }

      // Flag a list of checkboxes with multiple choices
      if ((formElement.type === 'checkboxes') && schemaElement.items) {
        var itemsEnum = schemaElement.items['enum'];
        if (itemsEnum) {
          schemaElement.items._jsonform_checkboxes_as_array = true;
        }
        if (!itemsEnum && schemaElement.items[0]) {
          itemsEnum = schemaElement.items[0]['enum'];
          if (itemsEnum) {
            schemaElement.items[0]._jsonform_checkboxes_as_array = true;
          }
        }
      }

      // If the form element targets an "object" in the JSON schema,
      // we need to recurse through the list of children to create an
      // input field per child property of the object in the JSON schema
      if (schemaElement.type === 'object') {
        schemaElement.properties.forEach((prop, propName) => {
          node.appendChild(this.buildFromLayout({
            key: formElement.key + '.' + propName
          }));
        }, this);
      }
    }

    if (!formElement.type) {
      formElement.type = 'none';
    }
    view = jsonform.elementTypes[formElement.type];
    if (!view) {
      throw new Error('The JSONForm contains an element whose type is unknown: "' +
        formElement.type + '"');
    }

    // A few characters need to be escaped to use the ID as jQuery selector
    formElement.iddot = escapeSelector(formElement.id || '');

    // Initialize the form node from the form element and schema element
    node.formElement = formElement;
    node.schemaElement = schemaElement;
    node.view = view;
    node.ownerTree = this;

    // Set event handlers
    if (!formElement.handlers) {
      formElement.handlers = {};
    }

    // Parse children recursively
    if (node.view.array) {
      // The form element is an array. The number of items in an array
      // is by definition dynamic, up to the form user (through "Add more",
      // "Delete" commands). The positions of the items in the array may
      // also change over time (through "Move up", "Move down" commands).
      //
      // The form node stores a "template" node that serves as basis for
      // the creation of an item in the array.
      //
      // Array items may be complex forms themselves, allowing for nesting.
      //
      // The initial values set the initial number of items in the array.
      // Note a form element contains at least one item when it is rendered.
      if (formElement.items) {
        key = formElement.items[0] || formElement.items;
      }
      else {
        key = formElement.key + '[]';
      }
      if (typeof (key) === 'string') {
        key = { key: key };
      }
      node.setChildTemplate(this.buildFromLayout(key));
    }
    else if (formElement.items) {
      // The form element defines children elements
      formElement.items.forEach(item => {
        if (typeof (item) === 'string') {
          item = { key: item };
        }
        node.appendChild(this.buildFromLayout(item));
      }, this);
    }

    return node;
  };


  /**
   * Computes the values associated with each input field in the tree based
   * on previously submitted values or default values in the JSON schema.
   *
   * For arrays, the function actually creates and inserts additional
   * nodes in the tree based on previously submitted values (also ensuring
   * that the array has at least one item).
   *
   * The function sets the array path on all nodes.
   * It should be called once in the lifetime of a form tree right after
   * the tree structure has been created.
   *
   * @function
   */
  formTree.prototype.computeInitialValues = function () {
    this.root.computeInitialValues(this.formDesc.value);
  };


  /**
   * Renders the form tree
   *
   * @function
   * @param {Node} domRoot The "form" element in the DOM tree that serves as
   *  root for the form
   */
  formTree.prototype.render = function (domRoot) {
    if (!domRoot) return;
    this.domRoot = domRoot;
    this.root.render();

    // If the schema defines required fields, flag the form with the
    // "jsonform-hasrequired" class for styling purpose
    // (typically so that users may display a legend)
    if (this.hasRequiredField()) {
      $(domRoot).addClass('jsonform-hasrequired');
    }
  };

  /**
   * Walks down the element tree with a callback
   *
   * @function
   * @param {Function} callback The callback to call on each element
   */
  formTree.prototype.forEachElement = function (callback) {

    var f = function (root) {
      for (var i = 0; i < root.children.length; i++) {
        callback(root.children[i]);
        f(root.children[i]);
      }
    };
    f(this.root);

  };

  formTree.prototype.validate = function (noErrorDisplay) {

    var values = jsonform.getFormValue(this.domRoot);
    var errors = false;

    var options = this.formDesc;

    if (options.validate !== false) {
      var validator = false;
      if (typeof options.validate != "object") {
        if (window.JSONFormValidator) {
          validator = window.JSONFormValidator.createEnvironment("json-schema-draft-03");
        }
      } else {
        validator = options.validate;
      }
      if (validator) {
        var v = validator.validate(values, this.formDesc.schema);
        $(this.domRoot).jsonFormErrors(false, options);
        if (v.errors.length) {
          if (!errors) errors = [];
          errors = errors.concat(v.errors);
        }
      }
    }

    if (errors && !noErrorDisplay) {
      if (options.displayErrors) {
        options.displayErrors(errors, this.domRoot);
      } else {
        $(this.domRoot).jsonFormErrors(errors, options);
      }
    }

    return { "errors": errors }

  }

  formTree.prototype.submit = function (evt) {

    var stopEvent = function () {
      if (evt) {
        evt.preventDefault();
        evt.stopPropagation();
      }
      return false;
    };
    var values = jsonform.getFormValue(this.domRoot);
    var options = this.formDesc;

    var brk = false;
    this.forEachElement(function (elt) {
      if (brk) return;
      if (elt.view.onSubmit) {
        brk = !elt.view.onSubmit(evt, elt); //may be called multiple times!!
      }
    });

    if (brk) return stopEvent();

    var validated = this.validate();

    if (options.onSubmit && !options.onSubmit(validated.errors, values)) {
      return stopEvent();
    }

    if (validated.errors) return stopEvent();

    if (options.onSubmitValid && !options.onSubmitValid(values)) {
      return stopEvent();
    }

    return false;

  };

  /**
   * Returns true if the form displays a "required" field.
   *
   * To keep things simple, the function parses the form's schema and returns
   * true as soon as it finds a "required" flag even though, in theory, that
   * schema key may not appear in the final form.
   *
   * Note that a "required" constraint on a boolean type is always enforced,
   * the code skips such definitions.
   *
   * @function
   * @return {boolean} True when the form has some required field,
   *  false otherwise.
   */
  formTree.prototype.hasRequiredField = function () {
    var parseElement = function (element) {
      if (!element) return null;
      if (element.required && (element.type !== 'boolean')) {
        return element;
      }
      
      if (!element.properties) return null;
      var prop = Object.keys(element.properties).find(function (property) {
        return parseElement(property);
      });
      if (prop) {
        return prop;
      }

      if (element.items) {
        if (Array.isArray(element.items)) {
          prop = Object.keys(element.items).find(function (item) {
            return parseElement(item);
          });
        }
        else {
          prop = parseElement(element.items);
        }
        if (prop) {
          return prop;
        }
      }
    };

    return parseElement(this.formDesc.schema);
  };



  /**
   * Returns the structured object that corresponds to the form values entered
   * by the use for the given form.
   *
   * The form must have been previously rendered through a call to jsonform.
   *
   * @function
   * @param {Node} The <form> tag in the DOM
   * @return {Object} The object that follows the data schema and matches the
   *  values entered by the user.
   */
  jsonform.getFormValue = function (formelt) {
    var form = $(formelt).data('jsonform-tree');
    if (!form) return null;
    return form.root.getFormValues();
  };


  /**
   * Highlights errors reported by the JSON schema validator in the document.
   *
   * @function
   * @param {Object} errors List of errors reported by the JSON schema validator
   * @param {Object} options The JSON Form object that describes the form
   *  (unused for the time being, could be useful to store example values or
   *   specific error messages)
   */
  $.fn.jsonFormErrors = function (errors, options) {
    $(".error", this).removeClass("error");
    $(".warning", this).removeClass("warning");

    $(".jsonform-errortext", this).hide();
    if (!errors) return;

    var errorSelectors = [];
    for (var i = 0; i < errors.length; i++) {
      // Compute the address of the input field in the form from the URI
      // returned by the JSON schema validator.
      // These URIs typically look like:
      //  urn:uuid:cccc265e-ffdd-4e40-8c97-977f7a512853#/pictures/1/thumbnail
      // What we need from that is the path in the value object:
      //  pictures[1].thumbnail
      // ... and the jQuery-friendly class selector of the input field:
      //  .jsonform-error-pictures\[1\]---thumbnail
      var key = errors[i].uri
        .replace(/.*#\//, '')
        .replace(/\//g, '.')
        .replace(/\.([0-9]+)(?=\.|$)/g, '[$1]');
      var errormarkerclass = ".jsonform-error-" +
        escapeSelector(key.replace(/\./g, "---"));
      errorSelectors.push(errormarkerclass);

      var errorType = errors[i].type || "error";
      $(errormarkerclass, this).addClass(errorType);
      $(errormarkerclass + " .jsonform-errortext", this).html(errors[i].message).show();
    }

    // Look for the first error in the DOM and ensure the element
    // is visible so that the user understands that something went wrong
    errorSelectors = errorSelectors.join(',');
    var firstError = $(errorSelectors).get(0);
    if (firstError && firstError.scrollIntoView) {
      firstError.scrollIntoView(true, {
        behavior: 'smooth'
      });
    }
  };

 
  /**
   * Generates the HTML form from the given JSON Form object and renders the form.
   *
   * Main entry point of the library. Defined as a jQuery function that typically
   * needs to be applied to a <form> element in the document.
   *
   * The function handles the following properties for the JSON Form object it
   * receives as parameter:
   * - schema (required): The JSON Schema that describes the form to render
   * - form: The options form layout description, overrides default layout
   * - prefix: String to use to prefix computed IDs. Default is an empty string.
   *  Use this option if JSON Form is used multiple times in an application with
   *  schemas that have overlapping parameter names to avoid running into multiple
   *  IDs issues. Default value is "jsonform-[counter]".
   * - transloadit: Transloadit parameters when transloadit is used
   * - validate: Validates form against schema upon submission. Uses the value
   * of the "validate" property as validator if it is an object.
   * - displayErrors: Function to call with errors upon form submission.
   *  Default is to render the errors next to the input fields.
   * - submitEvent: Name of the form submission event to bind to.
   *  Default is "submit". Set this option to false to avoid event binding.
   * - onSubmit: Callback function to call when form is submitted
   * - onSubmitValid: Callback function to call when form is submitted without
   *  errors.
   *
   * @function
   * @param {Object} options The JSON Form object to use as basis for the form
   */
  $.fn.jsonForm = function (options) {
    var formElt = this;

    options = defaults({}, options, { submitEvent: 'submit' });

    var form = new formTree();
    form.initialize(options);
    form.render(formElt.get(0));

    // TODO: move that to formTree.render
    if (options.transloadit) {
      formElt.append('<input type="hidden" name="params" value=\'' +
        escapeHTML(JSON.stringify(options.transloadit.params)) +
        '\'>');
    }

    // Keep a direct pointer to the JSON schema for form submission purpose
    formElt.data("jsonform-tree", form);

    if (options.submitEvent) {
      formElt.unbind((options.submitEvent) + '.jsonform');
      formElt.bind((options.submitEvent) + '.jsonform', function (evt) {
        form.submit(evt);
      });
    }

    // Initialize tabs sections, if any
    initializeTabs(formElt);

    // Initialize expandable sections, if any
    $('.expandable > div, .expandable > fieldset', formElt).hide();
    formElt.on('click', '.expandable > legend', function () {
      var parent = $(this).parent();
      parent.toggleClass('expanded');
      parent.find('legend').attr("aria-expanded", parent.hasClass("expanded"))
      $('> div', parent).slideToggle(100);
    });

    return form;
  };


  /**
   * Retrieves the structured values object generated from the values
   * entered by the user and the data schema that gave birth to the form.
   *
   * Defined as a jQuery function that typically needs to be applied to
   * a <form> element whose content has previously been generated by a
   * call to "jsonForm".
   *
   * Unless explicitly disabled, the values are automatically validated
   * against the constraints expressed in the schema.
   *
   * @function
   * @return {Object} Structured values object that matches the user inputs
   *  and the data schema.
   */
  $.fn.jsonFormValue = function () {
    return jsonform.getFormValue(this);
  };

  // Expose the getFormValue method to the window object
  // (other methods exposed as jQuery functions)
  window.JSONForm = window.JSONForm || { util: {} };
  window.JSONForm.getFormValue = jsonform.getFormValue;
  window.JSONForm.fieldTemplate = jsonform.fieldTemplate;
  window.JSONForm.fieldTypes = jsonform.elementTypes;
  window.JSONForm.getInitialValue = getInitialValue;
  window.JSONForm.util.getObjKey = jsonform.util.getObjKey;
  window.JSONForm.util.setObjKey = jsonform.util.setObjKey;

})(((typeof Zepto !== 'undefined') ? Zepto : { fn: {} }),
  ((typeof _ !== 'undefined') ? _ : null));
